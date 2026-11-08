"""Aggregates computed live from the database. Nothing here is precomputed or hard-coded."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select, text
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import require_admin, require_staff
from app.models import AcademicRecord, AuditLog, Dataset, ModelVersion, Prediction, Student, User
from app.schemas import Subject
from app.services.predictions import final_grades_for, latest_prediction_ids, summarise
from ml.config import PASS_MARK

router = APIRouter(prefix="/analytics", tags=["Analytics"])


def _round(value, digits: int = 2):
    return None if value is None else round(float(value), digits)


def _risk_counts(db: Session, subject: str | None = None) -> dict[str, int]:
    statement = (select(Prediction.risk_level, func.count())
                 .where(Prediction.id.in_(latest_prediction_ids()))
                 .group_by(Prediction.risk_level))
    if subject:
        statement = statement.where(Prediction.subject == subject)
    counts = {"low": 0, "moderate": 0, "high": 0}
    counts.update({level: count for level, count in db.execute(statement)})
    return counts


@router.get("/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(require_staff)) -> dict:
    grades = db.execute(select(
        func.avg(AcademicRecord.final_grade),
        func.count(AcademicRecord.final_grade),
        func.sum(case((AcademicRecord.final_grade >= PASS_MARK, 1), else_=0)),
    )).one()
    needing_attention = db.scalar(
        select(func.count(func.distinct(Prediction.student_id))).where(
            Prediction.id.in_(latest_prediction_ids()),
            Prediction.risk_level.in_(("moderate", "high")))
    )
    return {
        "total_students": db.scalar(select(func.count()).select_from(Student)),
        "demo_students": db.scalar(select(func.count()).select_from(Student)
                                   .where(Student.is_demo.is_(True))),
        "total_records": db.scalar(select(func.count()).select_from(AcademicRecord)),
        "total_predictions": db.scalar(select(func.count()).select_from(Prediction)),
        "demo_predictions": db.scalar(select(func.count()).select_from(Prediction)
                                      .where(Prediction.is_demo.is_(True))),
        "students_needing_attention": needing_attention,
        "average_final_grade": _round(grades[0]),
        "final_grades_recorded": grades[1],
        "pass_rate": _round(grades[2] / grades[1], 4) if grades[1] else None,
        "pass_mark": PASS_MARK,
        "risk_distribution": _risk_counts(db),
    }


@router.get("/performance")
def performance(db: Session = Depends(get_db), _: User = Depends(require_staff)) -> dict:
    rows = db.execute(
        select(
            AcademicRecord.subject,
            func.count(),
            func.avg(AcademicRecord.period1_grade),
            func.avg(AcademicRecord.period2_grade),
            func.avg(AcademicRecord.final_grade),
            func.count(AcademicRecord.final_grade),
            func.sum(case((AcademicRecord.final_grade >= PASS_MARK, 1), else_=0)),
            func.avg(AcademicRecord.absences),
        ).group_by(AcademicRecord.subject).order_by(AcademicRecord.subject)
    ).all()
    return {
        "pass_mark": PASS_MARK,
        "subjects": [
            {
                "subject": row[0], "records": row[1], "average_period1": _round(row[2]),
                "average_period2": _round(row[3]), "average_final": _round(row[4]),
                "final_grades_recorded": row[5],
                "pass_rate": _round(row[6] / row[5], 4) if row[5] else None,
                "average_absences": _round(row[7]),
            }
            for row in rows
        ],
    }


@router.get("/distribution")
def distribution(subject: Subject | None = None, db: Session = Depends(get_db),
                 _: User = Depends(require_staff)) -> dict:
    statement = (select(AcademicRecord.final_grade, AcademicRecord.subject, func.count())
                 .where(AcademicRecord.final_grade.is_not(None))
                 .group_by(AcademicRecord.final_grade, AcademicRecord.subject))
    if subject:
        statement = statement.where(AcademicRecord.subject == subject)
    histogram = {grade: {"grade": grade, "math": 0, "portuguese": 0} for grade in range(21)}
    for grade, row_subject, count in db.execute(statement):
        histogram[grade][row_subject] = count
    return {
        "pass_mark": PASS_MARK,
        "grades": list(histogram.values()),
        "risk_distribution": _risk_counts(db, subject),
    }


@router.get("/trends")
def trends(subject: Subject | None = None, days: int = Query(default=30, ge=1, le=365),
           db: Session = Depends(get_db), _: User = Depends(require_staff)) -> dict:
    statement = select(
        AcademicRecord.subject,
        func.avg(AcademicRecord.period1_grade),
        func.avg(AcademicRecord.period2_grade),
        func.avg(AcademicRecord.final_grade),
    ).group_by(AcademicRecord.subject)
    if subject:
        statement = statement.where(AcademicRecord.subject == subject)
    by_subject = {row[0]: row[1:] for row in db.execute(statement)}
    periods = [
        {"period": label,
         **{name: _round(values[index]) for name, values in by_subject.items()}}
        for index, label in enumerate(["First period", "Second period", "Final"])
    ]

    per_day = func.date(Prediction.created_at)
    activity = db.execute(
        select(per_day, func.count()).group_by(per_day).order_by(per_day.desc()).limit(days)
    ).all()
    return {
        "grades_by_period": periods,
        "predictions_per_day": [{"date": str(d), "count": c} for d, c in reversed(activity)],
    }


@router.get("/attention")
def attention(limit: int = Query(default=10, ge=1, le=100), db: Session = Depends(get_db),
              _: User = Depends(require_staff)) -> list[dict]:
    """Courses whose latest prediction is moderate or high, highest estimate first."""
    predictions = db.scalars(
        select(Prediction)
        .options(selectinload(Prediction.student), selectinload(Prediction.model_version))
        .where(Prediction.id.in_(latest_prediction_ids()),
               Prediction.risk_level.in_(("moderate", "high")))
        .order_by(Prediction.risk_probability.desc(), Prediction.id.desc()).limit(limit)
    ).all()
    finals = final_grades_for(db, list(predictions))
    return [summarise(p, finals.get(p.academic_record_id)) for p in predictions]


@router.get("/system")
def system_overview(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    roles = {role: 0 for role in ("admin", "educator", "student")}
    roles.update(dict(db.execute(select(User.role, func.count()).group_by(User.role)).all()))
    db.execute(text("SELECT 1"))
    logs = db.scalars(select(AuditLog).options(selectinload(AuditLog.actor))
                      .order_by(AuditLog.id.desc()).limit(12)).all()
    active = db.scalars(select(ModelVersion).where(ModelVersion.is_active.is_(True))
                        .order_by(ModelVersion.id)).all()
    return {
        "users_by_role": roles,
        "active_users": db.scalar(select(func.count()).select_from(User)
                                  .where(User.is_active.is_(True))),
        "datasets": db.scalar(select(func.count()).select_from(Dataset)),
        "database_status": "connected",
        "active_models": [
            {"version": m.version, "stage": m.stage, "classifier": m.classifier_algorithm,
             "regressor": m.regressor_algorithm, "trained_at": m.trained_at}
            for m in active
        ],
        "recent_activity": [
            {"id": log.id, "action": log.action,
             "actor": log.actor.full_name if log.actor else "System",
             "entity_type": log.entity_type, "entity_id": log.entity_id,
             "created_at": log.created_at}
            for log in logs
        ],
    }
