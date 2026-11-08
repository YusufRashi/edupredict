from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models import User
from app.schemas import Page, Role, UserCreate, UserOut, UserUpdate
from app.security import hash_password
from app.services.common import audit, like_pattern, paginate

router = APIRouter(prefix="/users", tags=["Users (admin)"])


def _get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return user


def _guard_last_admin(db: Session, user: User) -> None:
    admins = db.scalar(select(func.count()).select_from(User).where(
        User.role == "admin", User.is_active.is_(True)))
    if user.role == "admin" and user.is_active and admins <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This is the last active admin, so it must stay an active admin.")


@router.get("", response_model=Page[UserOut])
def list_users(
    q: str | None = Query(default=None, max_length=120),
    role: Role | None = None,
    is_active: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    statement = select(User).order_by(User.created_at.desc(), User.id.desc())
    if q:
        pattern = like_pattern(q)
        statement = statement.where(or_(User.email.ilike(pattern, escape="\\"),
                                        User.full_name.ilike(pattern, escape="\\")))
    if role:
        statement = statement.where(User.role == role)
    if is_active is not None:
        statement = statement.where(User.is_active.is_(is_active))
    items, total, pages = paginate(db, statement, page, page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size, "pages": pages}


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)) -> User:
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    user = User(email=email, full_name=body.full_name, role=body.role,
                hashed_password=hash_password(body.password))
    db.add(user)
    db.flush()
    audit(db, admin, "user.created", "user", user.id, f"role={body.role}")
    db.commit()
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)) -> User:
    user = _get_user(db, user_id)
    losing_admin = (body.role is not None and body.role != "admin") or body.is_active is False
    if losing_admin:
        _guard_last_admin(db, user)
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None and body.role != user.role:
        audit(db, admin, "user.role_changed", "user", user.id, f"{user.role} -> {body.role}")
        user.role = body.role
    if body.is_active is not None and body.is_active != user.is_active:
        audit(db, admin, "user.activated" if body.is_active else "user.deactivated",
              "user", user.id)
        user.is_active = body.is_active
    db.commit()
    return user


@router.delete("/{user_id}", response_model=UserOut)
def deactivate_user(user_id: int, db: Session = Depends(get_db),
                    admin: User = Depends(require_admin)) -> User:
    """Deactivates rather than deletes, so the audit history stays meaningful."""
    user = _get_user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You cannot deactivate your own account.")
    _guard_last_admin(db, user)
    user.is_active = False
    audit(db, admin, "user.deactivated", "user", user.id)
    db.commit()
    return user
