import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.database import get_db, utcnow
from app.deps import get_current_user
from app.models import Dataset, User
from app.schemas import DatasetOut, Page
from app.services.common import audit, get_setting, paginate
from app.services.datasets import import_rows, template_csv, validate_csv
from app.services.predictions import (
    create_prediction,
    get_pipeline,
    record_features,
    stage_for_record,
)

router = APIRouter(prefix="/datasets", tags=["Datasets"])
ALLOWED_TYPES = {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain",
                 "application/octet-stream", ""}


def require_dataset_access(user: User = Depends(get_current_user),
                           db: Session = Depends(get_db)) -> User:
    """Admins always. Educators only if an admin has turned that permission on."""
    allowed = user.role == "admin" or (
        user.role == "educator" and get_setting(db, "educators_can_upload_datasets"))
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "You do not have permission to manage datasets.")
    return user


def _out(dataset: Dataset) -> dict:
    report = {k: v for k, v in dataset.validation_report.items() if k != "rows"}
    return {
        "id": dataset.id, "name": dataset.name, "original_filename": dataset.original_filename,
        "size_bytes": dataset.size_bytes, "row_count": dataset.row_count,
        "column_count": dataset.column_count, "status": dataset.status,
        "validation_report": report, "processing_summary": dataset.processing_summary,
        "created_at": dataset.created_at, "processed_at": dataset.processed_at,
        "uploaded_by_name": dataset.uploaded_by.full_name if dataset.uploaded_by else None,
    }


def _get(db: Session, dataset_id: int) -> Dataset:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found.")
    return dataset


@router.get("/template")
def download_template(_: User = Depends(require_dataset_access)) -> Response:
    return Response(template_csv(), media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="edupredict-import-template.csv"'})


@router.post("/upload", response_model=DatasetOut, status_code=status.HTTP_201_CREATED)
async def upload_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(default=None, max_length=120),
    db: Session = Depends(get_db),
    actor: User = Depends(require_dataset_access),
) -> dict:
    """Validate a CSV. A file failing validation is recorded as rejected but not kept."""
    settings = get_settings()
    original = Path((file.filename or "upload.csv").replace("\\", "/")).name[:255]
    if not original.lower().endswith(".csv"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only .csv files are accepted.")
    if (file.content_type or "") not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only CSV files are accepted.")
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        limit = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE,
                            f"The file is larger than the {limit} MB limit.")

    digest = hashlib.sha256(content).hexdigest()
    duplicate = db.scalar(select(Dataset).where(Dataset.sha256 == digest,
                                                Dataset.status != "rejected"))
    if duplicate is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"This exact file was already uploaded as '{duplicate.name}'.")

    report = validate_csv(content, settings.max_upload_rows)
    report.pop("rows", None)
    stored = None
    if report["valid"]:
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        stored = f"{uuid.uuid4().hex}.csv"  # never a user-supplied path
        (settings.upload_dir / stored).write_bytes(content)

    dataset = Dataset(
        name=(name or "").strip() or original, original_filename=original,
        stored_filename=stored, sha256=digest, size_bytes=len(content),
        row_count=report["row_count"], column_count=report["column_count"],
        status="validated" if report["valid"] else "rejected", validation_report=report,
        uploaded_by_id=actor.id,
    )
    db.add(dataset)
    db.flush()
    audit(db, actor, f"dataset.{dataset.status}", "dataset", dataset.id,
          f"rows={dataset.row_count}")
    db.commit()
    return _out(dataset)


@router.get("", response_model=Page[DatasetOut])
def list_datasets(page: int = Query(default=1, ge=1),
                  page_size: int = Query(default=20, ge=1, le=100),
                  db: Session = Depends(get_db),
                  _: User = Depends(require_dataset_access)) -> dict:
    statement = (select(Dataset).options(selectinload(Dataset.uploaded_by))
                 .order_by(Dataset.id.desc()))
    items, total, pages = paginate(db, statement, page, page_size)
    return {"items": [_out(d) for d in items], "total": total, "page": page,
            "page_size": page_size, "pages": pages}


@router.get("/{dataset_id}", response_model=DatasetOut)
def get_dataset(dataset_id: int, db: Session = Depends(get_db),
                _: User = Depends(require_dataset_access)) -> dict:
    return _out(_get(db, dataset_id))


@router.post("/{dataset_id}/process", response_model=DatasetOut)
def process_dataset(dataset_id: int, run_predictions: bool = False,
                    db: Session = Depends(get_db),
                    actor: User = Depends(require_dataset_access)) -> dict:
    """Import a validated file. All rows succeed together or nothing changes."""
    settings = get_settings()
    dataset = _get(db, dataset_id)
    if dataset.status != "validated" or not dataset.stored_filename:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Only a validated, unprocessed dataset can be imported.")
    path = settings.upload_dir / dataset.stored_filename
    if not path.exists():
        raise HTTPException(status.HTTP_410_GONE, "The stored file is no longer available.")

    # Re-validate: what is imported must be what is on disk now.
    report = validate_csv(path.read_bytes(), settings.max_upload_rows)
    if not report["valid"]:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "The stored file no longer passes validation.")

    summary = import_rows(db, report["rows"], dataset.id)
    records = summary.pop("_records")
    summary["predictions_created"] = 0
    if run_predictions:
        pipeline = get_pipeline()
        for student, record in records:
            stage = stage_for_record(record)
            create_prediction(db, pipeline, stage=stage, features=record_features(record),
                              actor=actor, student=student, record=record)
            summary["predictions_created"] += 1

    dataset.status = "processed"
    dataset.processing_summary = summary
    dataset.processed_at = utcnow()
    audit(db, actor, "dataset.processed", "dataset", dataset.id,
          f"records={len(records)}, predictions={summary['predictions_created']}")
    db.commit()
    return _out(dataset)


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: int, db: Session = Depends(get_db),
                   actor: User = Depends(require_dataset_access)) -> None:
    """Removes the upload. Students already imported from it stay."""
    dataset = _get(db, dataset_id)
    if dataset.stored_filename:
        (get_settings().upload_dir / dataset.stored_filename).unlink(missing_ok=True)
    audit(db, actor, "dataset.deleted", "dataset", dataset.id)
    db.delete(dataset)
    db.commit()
