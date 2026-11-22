"""Model facts are read from the metadata written by training, never typed in by hand."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_staff
from app.models import ModelVersion, User
from app.schemas import StageKey
from app.services.predictions import get_pipeline

router = APIRouter(prefix="/model", tags=["Model"])


@router.get("/info")
def model_info(_: User = Depends(require_staff)) -> dict:
    metadata = get_pipeline().metadata
    return {
        "version": metadata["version"],
        "trained_at": metadata["trained_at"],
        "dataset": metadata["dataset"],
        "target": metadata["target"],
        "feature_policy": metadata["feature_policy"],
        "limitations": metadata["limitations"],
        "stages": [
            {
                "key": key,
                "label": stage["label"],
                "description": stage["description"],
                "features": stage["features"],
                "classifier_algorithm": stage["classifier"]["algorithm"],
                "regressor_algorithm": stage["regressor"]["algorithm"],
                "risk_bands": stage["classifier"]["risk_bands"],
                "classifier_test": stage["classifier"]["test"],
                "regressor_test": stage["regressor"]["test"],
            }
            for key, stage in metadata["stages"].items()
        ],
    }


@router.get("/metrics")
def model_metrics(stage: StageKey = "period1", _: User = Depends(require_staff)) -> dict:
    metadata = get_pipeline().metadata
    info = metadata["stages"].get(stage)
    if info is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No metrics for that stage.")
    strip = ("artifact", "artifact_sha256")
    return {
        "stage": stage,
        "version": metadata["version"],
        "label": info["label"],
        "description": info["description"],
        "classifier": {k: v for k, v in info["classifier"].items() if k not in strip},
        "regressor": {k: v for k, v in info["regressor"].items() if k not in strip},
        "fairness": info["fairness"],
    }


@router.get("/versions")
def model_versions(db: Session = Depends(get_db), _: User = Depends(require_staff)) -> list[dict]:
    versions = db.scalars(select(ModelVersion).order_by(ModelVersion.id.desc()).limit(60)).all()
    return [
        {"id": v.id, "version": v.version, "stage": v.stage, "is_active": v.is_active,
         "classifier_algorithm": v.classifier_algorithm,
         "regressor_algorithm": v.regressor_algorithm, "trained_at": v.trained_at,
         "test_metrics": v.test_metrics}
        for v in versions
    ]
