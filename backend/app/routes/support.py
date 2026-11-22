"""The weekly support list, follow-up actions and results. Staff only: students never see these."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db, utcnow
from app.deps import get_student_or_404, require_staff
from app.models import Prediction, SupportAction, User
from app.schemas import (
    ActionCreate,
    ActionOut,
    ActionStatus,
    ActionUpdate,
    Page,
    StaffMember,
    Subject,
    WatchState,
)
from app.services.common import audit, paginate
from app.services.support import (
    action_summary,
    build_results,
    build_watchlist,
    refresh_predictions,
    today,
)

router = APIRouter(prefix="/support", tags=["Support workflow"])


def _check_due_date(value) -> None:
    # One day of grace, because a teacher's local date can be behind the server's UTC date.
    if value < today() - timedelta(days=1):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "The follow-up date cannot be in the past.")


def _check_owner(db: Session, owner_id: int) -> None:
    owner = db.get(User, owner_id)
    if owner is None or not owner.is_active or owner.role not in ("admin", "educator"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "A follow-up can only be assigned to an active staff member.")


def _get_action(db: Session, action_id: int) -> SupportAction:
    action = db.get(SupportAction, action_id)
    if action is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Action not found.")
    return action


@router.get("/watchlist")
def watchlist(
    state: WatchState | None = None,
    subject: Subject | None = None,
    mine: bool = False,
    q: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
    actor: User = Depends(require_staff),
) -> dict:
    """Courses needing attention, most urgent first. Counts ignore the state filter."""
    items = build_watchlist(db)
    if mine:
        items = [i for i in items if i["next_action"] and i["next_action"]["owner_id"] == actor.id]
    if subject:
        items = [i for i in items if i["subject"] == subject]
    if q:
        term = q.strip().lower()
        items = [i for i in items if term in i["student_name"].lower()
                 or term in i["student_code"].lower()]
    counts = {key: 0 for key in ("overdue", "needs_action", "in_progress", "followed_up")}
    for item in items:
        counts[item["state"]] += 1
    if state:
        items = [i for i in items if i["state"] == state]
    total = len(items)
    start = (page - 1) * page_size
    return {"items": items[start:start + page_size], "counts": counts, "total": total,
            "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size))}


@router.post("/refresh")
def refresh(db: Session = Depends(get_db), actor: User = Depends(require_staff)) -> dict:
    """Re-score only the courses whose records changed since their last prediction."""
    result = refresh_predictions(db, actor)
    audit(db, actor, "support.refreshed", "prediction", None, f"scored={result['scored']}")
    db.commit()
    return result


@router.get("/results")
def results(include_demo: bool = True, db: Session = Depends(get_db),
            _: User = Depends(require_staff)) -> dict:
    return build_results(db, include_demo)


@router.get("/staff", response_model=list[StaffMember])
def staff(db: Session = Depends(get_db), _: User = Depends(require_staff)) -> list[User]:
    """Who a follow-up can be assigned to. Names only: educators cannot read the user list."""
    return list(db.scalars(select(User).where(User.is_active.is_(True),
                                              User.role.in_(("admin", "educator")))
                           .order_by(User.full_name)))


@router.get("/actions", response_model=Page[ActionOut])
def list_actions(
    student_id: int | None = None,
    action_status: ActionStatus | None = Query(default=None, alias="status"),
    mine: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    actor: User = Depends(require_staff),
) -> dict:
    statement = (select(SupportAction)
                 .options(selectinload(SupportAction.student), selectinload(SupportAction.owner),
                          selectinload(SupportAction.created_by))
                 .order_by(SupportAction.due_date.desc(), SupportAction.id.desc()))
    if student_id is not None:
        statement = statement.where(SupportAction.student_id == student_id)
    if action_status:
        statement = statement.where(SupportAction.status == action_status)
    if mine:
        statement = statement.where(SupportAction.owner_id == actor.id)
    items, total, pages = paginate(db, statement, page, page_size)
    return {"items": [action_summary(a) for a in items], "total": total, "page": page,
            "page_size": page_size, "pages": pages}


@router.post("/actions", response_model=ActionOut, status_code=status.HTTP_201_CREATED)
def create_action(body: ActionCreate, db: Session = Depends(get_db),
                  actor: User = Depends(require_staff)) -> dict:
    get_student_or_404(db, body.student_id)
    _check_due_date(body.due_date)
    owner_id = body.owner_id if body.owner_id is not None else actor.id
    _check_owner(db, owner_id)
    if body.prediction_id is not None:
        prediction = db.get(Prediction, body.prediction_id)
        if prediction is None or prediction.student_id != body.student_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                "That prediction does not belong to this student.")
    action = SupportAction(
        student_id=body.student_id, subject=body.subject, prediction_id=body.prediction_id,
        action_type=body.action_type, note=(body.note or "").strip() or None,
        due_date=body.due_date, owner_id=owner_id, created_by_id=actor.id, status="planned",
    )
    db.add(action)
    db.flush()
    audit(db, actor, "support.action_created", "student", body.student_id)
    db.commit()
    return action_summary(action)


@router.patch("/actions/{action_id}", response_model=ActionOut)
def update_action(action_id: int, body: ActionUpdate, db: Session = Depends(get_db),
                  actor: User = Depends(require_staff)) -> dict:
    action = _get_action(db, action_id)
    if body.due_date is not None and body.due_date != action.due_date:
        _check_due_date(body.due_date)
        action.due_date = body.due_date
    if body.owner_id is not None:
        _check_owner(db, body.owner_id)
        action.owner_id = body.owner_id
    if body.note is not None:
        action.note = body.note.strip() or None
    if body.outcome_note is not None:
        action.outcome_note = body.outcome_note.strip() or None
    if body.status is not None and body.status != action.status:
        action.status = body.status
        action.completed_at = utcnow() if body.status == "done" else None
        audit(db, actor, f"support.action_{body.status}", "student", action.student_id)
    db.commit()
    db.refresh(action)
    return action_summary(action)


@router.delete("/actions/{action_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_action(action_id: int, db: Session = Depends(get_db),
                  actor: User = Depends(require_staff)) -> None:
    action = _get_action(db, action_id)
    audit(db, actor, "support.action_deleted", "student", action.student_id)
    db.delete(action)
    db.commit()
