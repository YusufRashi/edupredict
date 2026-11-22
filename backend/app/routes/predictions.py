from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import get_student_or_404, require_staff
from app.models import (
    AcademicRecommendation,
    AcademicRecord,
    Prediction,
    PredictionHistory,
    Student,
    User,
)
from app.schemas import (
    Page,
    PredictionCreate,
    PredictionDetail,
    PredictionSummary,
    ReviewRequest,
    RiskLevel,
    StageKey,
    Subject,
)
from app.services.common import audit, like_pattern, paginate
from app.services.predictions import (
    DISCLAIMER,
    create_prediction,
    final_grades_for,
    get_pipeline,
    summarise,
)
from ml.config import FEATURE_SPECS, PASS_MARK, STAGES

router = APIRouter(prefix="/predictions", tags=["Predictions"])


def _detail(db: Session, prediction: Prediction) -> dict:
    final = final_grades_for(db, [prediction]).get(prediction.academic_record_id)
    recommendations = db.scalars(
        select(AcademicRecommendation).where(AcademicRecommendation.prediction_id == prediction.id)
        .order_by(AcademicRecommendation.id)
    ).all()
    return {
        **summarise(prediction, final),
        "input_features": prediction.input_features,
        "contributions": prediction.contributions,
        "classifier_algorithm": prediction.model_version.classifier_algorithm,
        "regressor_algorithm": prediction.model_version.regressor_algorithm,
        "requested_by_name": prediction.requested_by.full_name if prediction.requested_by else None,
        "history": [
            {"action": h.action, "actor_name": h.actor.full_name if h.actor else None,
             "note": h.note, "created_at": h.created_at}
            for h in prediction.history
        ],
        "recommendations": recommendations,
        "disclaimer": DISCLAIMER,
        "estimates_disagree": (prediction.predicted_grade < PASS_MARK)
                              != prediction.predicted_at_risk,
        "pass_mark": PASS_MARK,
    }


@router.get("/options")
def prediction_options(_: User = Depends(require_staff)) -> dict:
    """Everything the prediction form needs, so that it cannot drift from the model."""
    return {
        "stages": [{"key": s.key, "label": s.label, "description": s.description,
                    "features": s.features} for s in STAGES.values()],
        "features": {
            name: {"label": s.label, "kind": s.kind, "help": s.help, "minimum": s.minimum,
                   "maximum": s.maximum, "choices": list(s.choices)}
            for name, s in FEATURE_SPECS.items()
        },
    }


@router.post("", response_model=PredictionDetail, status_code=status.HTTP_201_CREATED)
def run_prediction(body: PredictionCreate, db: Session = Depends(get_db),
                   actor: User = Depends(require_staff)) -> dict:
    student = get_student_or_404(db, body.student_id) if body.student_id else None
    record = None
    if body.academic_record_id is not None:
        record = db.get(AcademicRecord, body.academic_record_id)
        if record is None or student is None or record.student_id != student.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                "That academic record does not belong to this student.")
        if body.features.get("subject") != record.subject:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                "The subject must match the selected academic record.")
    prediction = create_prediction(db, get_pipeline(), stage=body.stage, features=body.features,
                                   actor=actor, student=student, record=record)
    audit(db, actor, "prediction.created", "prediction", prediction.id)
    db.commit()
    return _detail(db, prediction)


@router.get("", response_model=Page[PredictionSummary])
def list_predictions(
    student_id: int | None = None,
    q: str | None = Query(default=None, max_length=120),
    risk_level: RiskLevel | None = None,
    stage: StageKey | None = None,
    subject: Subject | None = None,
    is_demo: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
) -> dict:
    statement = (select(Prediction)
                 .options(selectinload(Prediction.student), selectinload(Prediction.model_version))
                 .order_by(Prediction.id.desc()))
    if student_id is not None:
        statement = statement.where(Prediction.student_id == student_id)
    if q:
        pattern = like_pattern(q)
        statement = statement.join(Student, Prediction.student_id == Student.id).where(
            or_(Student.full_name.ilike(pattern, escape="\\"),
                Student.student_code.ilike(pattern, escape="\\")))
    if risk_level:
        statement = statement.where(Prediction.risk_level == risk_level)
    if stage:
        statement = statement.where(Prediction.stage == stage)
    if subject:
        statement = statement.where(Prediction.subject == subject)
    if is_demo is not None:
        statement = statement.where(Prediction.is_demo.is_(is_demo))

    items, total, pages = paginate(db, statement, page, page_size)
    finals = final_grades_for(db, items)
    return {"items": [summarise(p, finals.get(p.academic_record_id)) for p in items],
            "total": total, "page": page, "page_size": page_size, "pages": pages}


def _get_prediction(db: Session, prediction_id: int) -> Prediction:
    prediction = db.get(Prediction, prediction_id)
    if prediction is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prediction not found.")
    return prediction


@router.get("/{prediction_id}", response_model=PredictionDetail)
def get_prediction(prediction_id: int, db: Session = Depends(get_db),
                   _: User = Depends(require_staff)) -> dict:
    return _detail(db, _get_prediction(db, prediction_id))


@router.post("/{prediction_id}/review", response_model=PredictionDetail,
             status_code=status.HTTP_201_CREATED)
def review_prediction(prediction_id: int, body: ReviewRequest, db: Session = Depends(get_db),
                      actor: User = Depends(require_staff)) -> dict:
    """Record an educator's own judgment alongside the model's estimate."""
    prediction = _get_prediction(db, prediction_id)
    db.add(PredictionHistory(prediction_id=prediction.id, action="reviewed", actor_id=actor.id,
                             note=body.note))
    audit(db, actor, "prediction.reviewed", "prediction", prediction.id)
    db.commit()
    db.refresh(prediction)
    return _detail(db, prediction)
