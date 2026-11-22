"""Run the ML pipeline and persist predictions with their audit trail."""

from datetime import datetime
from functools import lru_cache
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.database import utcnow
from app.models import (
    AcademicRecommendation,
    AcademicRecord,
    ModelVersion,
    Prediction,
    PredictionHistory,
    Student,
    User,
)
from app.services.recommendations import build_recommendations
from ml.config import ARTIFACT_DIR
from ml.predict import ModelUnavailableError, PredictionPipeline

DISCLAIMER = (
    "This is an estimate from a statistical model trained on historical data from two Portuguese "
    "secondary schools. It is decision support for educators, not a judgment about the student, "
    "and must be weighed alongside professional knowledge of the student."
)


@lru_cache(maxsize=1)
def get_pipeline() -> PredictionPipeline:
    return PredictionPipeline(ARTIFACT_DIR)


def sync_model_versions(db: Session, pipeline: PredictionPipeline) -> None:
    """Register the loaded artifacts as the active versions. Earlier rows stay for history."""
    metadata = pipeline.metadata
    db.execute(update(ModelVersion).where(ModelVersion.version != pipeline.version)
               .values(is_active=False))
    for stage, info in metadata["stages"].items():
        existing = db.scalar(select(ModelVersion).where(ModelVersion.version == pipeline.version,
                                                        ModelVersion.stage == stage))
        if existing is None:
            db.add(ModelVersion(
                version=pipeline.version, stage=stage,
                classifier_algorithm=info["classifier"]["algorithm"],
                regressor_algorithm=info["regressor"]["algorithm"],
                trained_at=datetime.fromisoformat(metadata["trained_at"]),
                dataset_sha256=metadata["dataset"]["sha256"],
                test_metrics={"classifier": info["classifier"]["test"],
                              "regressor": info["regressor"]["test"]},
                is_active=True,
            ))
    db.commit()


def active_version(db: Session, pipeline: PredictionPipeline, stage: str) -> ModelVersion:
    version = db.scalar(select(ModelVersion).where(ModelVersion.version == pipeline.version,
                                                   ModelVersion.stage == stage))
    if version is None:
        sync_model_versions(db, pipeline)
        version = db.scalar(select(ModelVersion).where(ModelVersion.version == pipeline.version,
                                                       ModelVersion.stage == stage))
    if version is None:
        raise ModelUnavailableError(f"No registered model for stage '{stage}'.")
    return version


def record_features(record: AcademicRecord) -> dict[str, Any]:
    """Translate a stored record into the model's input vocabulary."""
    features: dict[str, Any] = {
        "subject": record.subject,
        "studytime": record.study_time,
        "failures": record.past_failures,
        "absences": record.absences,
        "schoolsup": "yes" if record.school_support else "no",
        "activities": "yes" if record.activities else "no",
        "higher": "yes" if record.wants_higher_education else "no",
    }
    if record.period1_grade is not None:
        features["G1"] = record.period1_grade
    if record.period2_grade is not None:
        features["G2"] = record.period2_grade
    return features


def stage_for_record(record: AcademicRecord) -> str:
    """The latest stage whose grades are all known for this record."""
    if record.period1_grade is None:
        return "intake"
    return "period2" if record.period2_grade is not None else "period1"


def create_prediction(
    db: Session,
    pipeline: PredictionPipeline,
    *,
    stage: str,
    features: dict[str, Any],
    actor: User | None,
    student: Student | None = None,
    record: AcademicRecord | None = None,
    share_recommendations: bool = False,
    is_demo: bool = False,
) -> Prediction:
    """Score, then store everything in the caller's transaction. Does not commit."""
    result = pipeline.predict(stage, features)
    used = {c.feature: c.value for c in result.contributions}
    prediction = Prediction(
        student_id=student.id if student else None,
        academic_record_id=record.id if record else None,
        model_version_id=active_version(db, pipeline, stage).id,
        requested_by_id=actor.id if actor else None,
        stage=stage,
        subject=used["subject"],
        input_features=used,
        predicted_at_risk=result.predicted_at_risk,
        risk_probability=result.risk_probability,
        risk_level=result.risk_level,
        confidence=result.confidence,
        predicted_grade=result.predicted_grade,
        grade_interval_low=result.grade_interval_low,
        grade_interval_high=result.grade_interval_high,
        contributions=[vars(c) for c in result.contributions],
        is_demo=is_demo or bool(student and student.is_demo),
        created_at=utcnow(),
    )
    db.add(prediction)
    db.flush()
    db.add(PredictionHistory(prediction_id=prediction.id, action="created",
                             actor_id=actor.id if actor else None))

    if student is not None:
        # New rule-based advice replaces earlier unshared advice for the same subject.
        # Anything an educator wrote, or already shared with the student, is kept.
        previous = select(Prediction.id).where(Prediction.student_id == student.id,
                                               Prediction.subject == prediction.subject)
        db.execute(delete(AcademicRecommendation).where(
            AcademicRecommendation.student_id == student.id,
            AcademicRecommendation.source == "rule",
            AcademicRecommendation.shared_with_student.is_(False),
            AcademicRecommendation.prediction_id.in_(previous),
        ))
        for item in build_recommendations(used, result.risk_level):
            db.add(AcademicRecommendation(
                student_id=student.id, prediction_id=prediction.id, source="rule",
                shared_with_student=share_recommendations,
                created_by_id=actor.id if actor else None, **item,
            ))
    return prediction


def latest_prediction_ids():
    """Newest prediction for each student in each subject."""
    return (select(func.max(Prediction.id))
            .where(Prediction.student_id.is_not(None))
            .group_by(Prediction.student_id, Prediction.subject))


def summarise(prediction: Prediction, final_grade: int | None = None) -> dict:
    student = prediction.student
    return {
        "id": prediction.id,
        "student_id": prediction.student_id,
        "student_name": student.full_name if student else None,
        "student_code": student.student_code if student else None,
        "academic_record_id": prediction.academic_record_id,
        "stage": prediction.stage,
        "subject": prediction.subject,
        "predicted_at_risk": prediction.predicted_at_risk,
        "risk_probability": prediction.risk_probability,
        "risk_level": prediction.risk_level,
        "confidence": prediction.confidence,
        "predicted_grade": prediction.predicted_grade,
        "grade_interval_low": prediction.grade_interval_low,
        "grade_interval_high": prediction.grade_interval_high,
        "is_demo": prediction.is_demo,
        "model_version": prediction.model_version.version,
        "actual_final_grade": final_grade,
        "created_at": prediction.created_at,
    }


def final_grades_for(db: Session, predictions: list[Prediction]) -> dict[int, int | None]:
    record_ids = {p.academic_record_id for p in predictions if p.academic_record_id}
    if not record_ids:
        return {}
    rows = db.execute(select(AcademicRecord.id, AcademicRecord.final_grade)
                      .where(AcademicRecord.id.in_(record_ids))).all()
    return dict(rows)
