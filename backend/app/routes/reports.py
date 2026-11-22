"""Staff-only reports as JSON (printable view) or CSV. Each export is audited."""

import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db, utcnow
from app.deps import require_staff
from app.models import AcademicRecord, Prediction, Student, User
from app.schemas import FORMULA_PREFIXES, RiskLevel, Subject
from app.services.common import audit
from app.services.predictions import DISCLAIMER, latest_prediction_ids
from ml.config import PASS_MARK

router = APIRouter(prefix="/reports", tags=["Reports"])

PERFORMANCE_COLUMNS = [
    "student_code", "full_name", "year_group", "subject", "academic_year", "period1_grade",
    "period2_grade", "final_grade", "result", "absences", "study_time", "past_failures",
    "data_type",
]
RISK_COLUMNS = [
    "student_code", "full_name", "year_group", "subject", "risk_level", "risk_probability",
    "predicted_grade", "grade_interval_low", "grade_interval_high", "stage", "actual_final_grade",
    "model_version", "predicted_at", "data_type",
]


def safe_cell(value: object) -> object:
    """Stop spreadsheets from running a cell as a formula (CSV injection)."""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def to_csv(columns: list[str], rows: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([safe_cell(row[c]) for c in columns])
    return buffer.getvalue()


def _respond(kind: str, title: str, columns: list[str], rows: list[dict], fmt: str,
             actor: User, db: Session):
    audit(db, actor, f"report.{kind}.{fmt}", "report", None, f"rows={len(rows)}")
    db.commit()
    generated = utcnow()
    if fmt == "csv":
        filename = f"edupredict-{kind}-report-{generated:%Y%m%d-%H%M}.csv"
        return Response(
            to_csv(columns, rows), media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"',
                     "Cache-Control": "no-store"},
        )
    return {
        "title": title, "generated_at": generated, "generated_by": actor.full_name,
        "disclaimer": DISCLAIMER, "pass_mark": PASS_MARK, "total": len(rows),
        "demo_rows": sum(1 for row in rows if row["data_type"] == "demonstration"),
        "columns": columns, "rows": rows,
    }


@router.get("/performance", response_model=None)
def performance_report(
    format: Literal["json", "csv"] = "json",
    subject: Subject | None = None,
    year_group: str | None = Query(default=None, max_length=40),
    student_id: int | None = None,
    db: Session = Depends(get_db),
    actor: User = Depends(require_staff),
):
    statement = (select(AcademicRecord).join(Student).options(joinedload(AcademicRecord.student))
                 .order_by(Student.full_name, AcademicRecord.academic_year,
                           AcademicRecord.subject))
    if subject:
        statement = statement.where(AcademicRecord.subject == subject)
    if year_group:
        statement = statement.where(Student.year_group == year_group)
    if student_id is not None:
        statement = statement.where(AcademicRecord.student_id == student_id)

    rows = []
    for record in db.scalars(statement):
        student = record.student
        final = record.final_grade
        rows.append({
            "student_code": student.student_code, "full_name": student.full_name,
            "year_group": student.year_group, "subject": record.subject,
            "academic_year": record.academic_year, "period1_grade": record.period1_grade,
            "period2_grade": record.period2_grade, "final_grade": final,
            "result": None if final is None else "pass" if final >= PASS_MARK else "below pass",
            "absences": record.absences, "study_time": record.study_time,
            "past_failures": record.past_failures,
            "data_type": "demonstration" if student.is_demo else "institution",
        })
    return _respond("performance", "Student performance report", PERFORMANCE_COLUMNS, rows,
                    format, actor, db)


@router.get("/risk", response_model=None)
def risk_report(
    format: Literal["json", "csv"] = "json",
    subject: Subject | None = None,
    risk_level: RiskLevel | None = None,
    db: Session = Depends(get_db),
    actor: User = Depends(require_staff),
):
    statement = (select(Prediction).join(Student, Prediction.student_id == Student.id)
                 .options(selectinload(Prediction.student), selectinload(Prediction.model_version))
                 .where(Prediction.id.in_(latest_prediction_ids()))
                 .order_by(Prediction.risk_probability.desc(), Prediction.id.desc()))
    if subject:
        statement = statement.where(Prediction.subject == subject)
    if risk_level:
        statement = statement.where(Prediction.risk_level == risk_level)
    predictions = db.scalars(statement).all()

    record_ids = [p.academic_record_id for p in predictions if p.academic_record_id]
    finals = dict(db.execute(select(AcademicRecord.id, AcademicRecord.final_grade)
                             .where(AcademicRecord.id.in_(record_ids))).all()) if record_ids else {}
    rows = [
        {
            "student_code": p.student.student_code, "full_name": p.student.full_name,
            "year_group": p.student.year_group, "subject": p.subject,
            "risk_level": p.risk_level, "risk_probability": p.risk_probability,
            "predicted_grade": p.predicted_grade, "grade_interval_low": p.grade_interval_low,
            "grade_interval_high": p.grade_interval_high, "stage": p.stage,
            "actual_final_grade": finals.get(p.academic_record_id),
            "model_version": p.model_version.version, "predicted_at": p.created_at.isoformat(),
            "data_type": "demonstration" if p.is_demo else "institution",
        }
        for p in predictions
    ]
    return _respond("risk", "Academic risk report", RISK_COLUMNS, rows, format, actor, db)
