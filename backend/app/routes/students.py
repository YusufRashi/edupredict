from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import get_current_user, get_student_or_404, require_staff
from app.models import AcademicRecommendation, AcademicRecord, Prediction, Student, User
from app.schemas import (
    Page,
    RecommendationCreate,
    RecommendationOut,
    RecommendationUpdate,
    RecordCreate,
    RecordOut,
    RiskLevel,
    StudentCreate,
    StudentDetail,
    StudentListItem,
    StudentUpdate,
    Subject,
)
from app.services.common import audit, like_pattern, paginate
from app.services.predictions import final_grades_for, latest_prediction_ids, summarise

router = APIRouter(prefix="/students", tags=["Students"])
RISK_ORDER = {"low": 0, "moderate": 1, "high": 2}


def _link_account(db: Session, student: Student, email: str | None) -> None:
    """Link a student login to this record. Only staff can do this."""
    if email is None:
        student.user_id = None
        return
    user = db.scalar(select(User).where(User.email == email.lower()))
    if user is None or user.role != "student":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "No student account exists with that email.")
    other = db.scalar(select(Student).where(Student.user_id == user.id, Student.id != student.id))
    if other is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "That account is already linked to another student.")
    student.user_id = user.id


def _check_code_free(db: Session, code: str, student_id: int | None = None) -> None:
    existing = db.scalar(select(Student).where(Student.student_code == code))
    if existing is not None and existing.id != student_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This student code is already in use.")


def _detail(db: Session, student: Student, viewer: User) -> dict:
    """Students get their own records and shared advice, but never raw risk predictions."""
    is_staff = viewer.role in ("admin", "educator")
    recommendations = db.scalars(
        select(AcademicRecommendation)
        .where(AcademicRecommendation.student_id == student.id,
               *([] if is_staff else [AcademicRecommendation.shared_with_student.is_(True)]))
        .order_by(AcademicRecommendation.created_at.desc(), AcademicRecommendation.id.desc())
    ).all()
    latest: list[dict] = []
    if is_staff:
        predictions = db.scalars(
            select(Prediction)
            .where(Prediction.id.in_(latest_prediction_ids()), Prediction.student_id == student.id)
            .order_by(Prediction.id.desc())
        ).all()
        finals = final_grades_for(db, list(predictions))
        latest = [summarise(p, finals.get(p.academic_record_id)) for p in predictions]
    return {
        "id": student.id, "student_code": student.student_code, "full_name": student.full_name,
        "email": student.email, "year_group": student.year_group, "is_demo": student.is_demo,
        "linked_user_email": student.user.email if is_staff and student.user else None,
        "records": student.records, "latest_predictions": latest,
        "recommendations": recommendations,
    }


@router.get("", response_model=Page[StudentListItem])
def list_students(
    q: str | None = Query(default=None, max_length=120, description="Name or student code"),
    year_group: str | None = Query(default=None, max_length=40),
    subject: Subject | None = None,
    risk_level: RiskLevel | None = None,
    is_demo: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
) -> dict:
    statement = select(Student).options(selectinload(Student.records)).order_by(Student.full_name)
    if q:
        pattern = like_pattern(q)
        statement = statement.where(or_(Student.full_name.ilike(pattern, escape="\\"),
                                        Student.student_code.ilike(pattern, escape="\\")))
    if year_group:
        statement = statement.where(Student.year_group == year_group)
    if is_demo is not None:
        statement = statement.where(Student.is_demo.is_(is_demo))
    if subject:
        statement = statement.where(Student.id.in_(
            select(AcademicRecord.student_id).where(AcademicRecord.subject == subject)))
    if risk_level:
        statement = statement.where(Student.id.in_(
            select(Prediction.student_id).where(Prediction.id.in_(latest_prediction_ids()),
                                                Prediction.risk_level == risk_level)))
    students, total, pages = paginate(db, statement, page, page_size)

    ids = [s.id for s in students]
    risks: dict[int, str] = {}
    if ids:
        for student_id, level in db.execute(
            select(Prediction.student_id, Prediction.risk_level).where(
                Prediction.id.in_(latest_prediction_ids()), Prediction.student_id.in_(ids))
        ):
            if RISK_ORDER[level] >= RISK_ORDER.get(risks.get(student_id, ""), -1):
                risks[student_id] = level

    items = []
    for student in students:
        finals = [r.final_grade for r in student.records if r.final_grade is not None]
        items.append({
            "id": student.id, "student_code": student.student_code,
            "full_name": student.full_name, "year_group": student.year_group,
            "is_demo": student.is_demo,
            "subjects": sorted({r.subject for r in student.records}),
            "average_final_grade": round(sum(finals) / len(finals), 1) if finals else None,
            "highest_risk": risks.get(student.id),
        })
    return {"items": items, "total": total, "page": page, "page_size": page_size, "pages": pages}


@router.get("/year-groups", response_model=list[str])
def list_year_groups(db: Session = Depends(get_db), _: User = Depends(require_staff)) -> list[str]:
    return list(db.scalars(select(Student.year_group).where(Student.year_group.is_not(None))
                           .distinct().order_by(Student.year_group)))


@router.get("/me", response_model=StudentDetail)
def my_record(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    student = db.scalar(select(Student).where(Student.user_id == user.id))
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Your account is not linked to a student record yet.")
    return _detail(db, student, user)


@router.post("", response_model=StudentDetail, status_code=status.HTTP_201_CREATED)
def create_student(body: StudentCreate, db: Session = Depends(get_db),
                   actor: User = Depends(require_staff)) -> dict:
    _check_code_free(db, body.student_code)
    student = Student(student_code=body.student_code, full_name=body.full_name,
                      email=str(body.email).lower() if body.email else None,
                      year_group=body.year_group)
    _link_account(db, student, body.linked_user_email)
    db.add(student)
    db.flush()
    audit(db, actor, "student.created", "student", student.id)
    db.commit()
    return _detail(db, student, actor)


@router.get("/{student_id}", response_model=StudentDetail)
def get_student(student_id: int, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> dict:
    student = get_student_or_404(db, student_id)
    if user.role == "student" and student.user_id != user.id:
        # Same reply as a missing record, so students cannot discover which IDs exist.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")
    return _detail(db, student, user)


@router.put("/{student_id}", response_model=StudentDetail)
def update_student(student_id: int, body: StudentUpdate, db: Session = Depends(get_db),
                   actor: User = Depends(require_staff)) -> dict:
    student = get_student_or_404(db, student_id)
    _check_code_free(db, body.student_code, student.id)
    student.student_code = body.student_code
    student.full_name = body.full_name
    student.email = str(body.email).lower() if body.email else None
    student.year_group = body.year_group
    _link_account(db, student, body.linked_user_email)
    audit(db, actor, "student.updated", "student", student.id)
    db.commit()
    db.refresh(student)
    return _detail(db, student, actor)


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student(student_id: int, db: Session = Depends(get_db),
                   actor: User = Depends(require_staff)) -> None:
    """Permanently removes the student's records, predictions and recommendations."""
    student = get_student_or_404(db, student_id)
    audit(db, actor, "student.deleted", "student", student.id)
    db.delete(student)
    db.commit()


# ---- Academic records ----
def _get_record(db: Session, student_id: int, record_id: int) -> AcademicRecord:
    record = db.get(AcademicRecord, record_id)
    if record is None or record.student_id != student_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Academic record not found.")
    return record


def _check_record_free(db: Session, student_id: int, body: RecordCreate,
                       record_id: int | None = None) -> None:
    existing = db.scalar(select(AcademicRecord).where(
        AcademicRecord.student_id == student_id, AcademicRecord.subject == body.subject,
        AcademicRecord.academic_year == body.academic_year))
    if existing is not None and existing.id != record_id:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This student already has a record for that subject and year.")


@router.post("/{student_id}/records", response_model=RecordOut,
             status_code=status.HTTP_201_CREATED)
def create_record(student_id: int, body: RecordCreate, db: Session = Depends(get_db),
                  actor: User = Depends(require_staff)) -> AcademicRecord:
    get_student_or_404(db, student_id)
    _check_record_free(db, student_id, body)
    record = AcademicRecord(student_id=student_id, **body.model_dump())
    db.add(record)
    db.flush()
    audit(db, actor, "record.created", "student", student_id)
    db.commit()
    return record


@router.put("/{student_id}/records/{record_id}", response_model=RecordOut)
def update_record(student_id: int, record_id: int, body: RecordCreate,
                  db: Session = Depends(get_db),
                  actor: User = Depends(require_staff)) -> AcademicRecord:
    record = _get_record(db, student_id, record_id)
    _check_record_free(db, student_id, body, record.id)
    for key, value in body.model_dump().items():
        setattr(record, key, value)
    audit(db, actor, "record.updated", "student", student_id)
    db.commit()
    return record


@router.delete("/{student_id}/records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_record(student_id: int, record_id: int, db: Session = Depends(get_db),
                  actor: User = Depends(require_staff)) -> None:
    record = _get_record(db, student_id, record_id)
    audit(db, actor, "record.deleted", "student", student_id)
    db.delete(record)
    db.commit()


# ---- Recommendations ----
@router.post("/{student_id}/recommendations", response_model=RecommendationOut,
             status_code=status.HTTP_201_CREATED)
def create_recommendation(student_id: int, body: RecommendationCreate,
                          db: Session = Depends(get_db),
                          actor: User = Depends(require_staff)) -> AcademicRecommendation:
    get_student_or_404(db, student_id)
    item = AcademicRecommendation(student_id=student_id, source="educator",
                                  created_by_id=actor.id, **body.model_dump())
    db.add(item)
    db.commit()
    return item


@router.patch("/{student_id}/recommendations/{recommendation_id}",
              response_model=RecommendationOut)
def update_recommendation(student_id: int, recommendation_id: int, body: RecommendationUpdate,
                          db: Session = Depends(get_db),
                          actor: User = Depends(require_staff)) -> AcademicRecommendation:
    item = db.get(AcademicRecommendation, recommendation_id)
    if item is None or item.student_id != student_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recommendation not found.")
    if body.status is not None:
        item.status = body.status
    if body.shared_with_student is not None:
        item.shared_with_student = body.shared_with_student
        audit(db, actor, "recommendation.shared" if body.shared_with_student
              else "recommendation.unshared", "student", student_id)
    db.commit()
    return item


@router.delete("/{student_id}/recommendations/{recommendation_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def delete_recommendation(student_id: int, recommendation_id: int, db: Session = Depends(get_db),
                          _: User = Depends(require_staff)) -> None:
    item = db.get(AcademicRecommendation, recommendation_id)
    if item is None or item.student_id != student_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recommendation not found.")
    db.delete(item)
    db.commit()
