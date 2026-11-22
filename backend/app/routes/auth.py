from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import as_utc, get_db, utcnow
from app.deps import get_current_user
from app.models import User
from app.schemas import (
    LoginRequest,
    PasswordChange,
    ProfileUpdate,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.security import create_access_token, hash_password, verify_password
from app.services.common import audit, get_setting

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> User:
    """Create a student account. The role is fixed: staff accounts are created by an admin.

    A new account is not linked to any student record, because email ownership is not
    verified here. Staff link accounts to records explicitly.
    """
    if not get_setting(db, "allow_public_registration"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Public registration is turned off.")
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    user = User(email=email, full_name=body.full_name,
                hashed_password=hash_password(body.password), role="student")
    db.add(user)
    db.flush()
    audit(db, user, "user.registered", "user", user.id)
    db.commit()
    return user


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password.")
    user = db.scalar(select(User).where(User.email == body.email.lower()))

    if user is not None and user.locked_until and as_utc(user.locked_until) > utcnow():
        verify_password(body.password, None)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Too many failed attempts. Please try again later.")

    if not verify_password(body.password, user.hashed_password if user else None):
        if user is not None:
            user.failed_logins += 1
            if user.failed_logins >= settings.max_failed_logins:
                user.locked_until = utcnow() + timedelta(minutes=settings.lockout_minutes)
                user.failed_logins = 0
                audit(db, user, "user.locked", "user", user.id)
            db.commit()
        raise invalid
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated.")

    user.failed_logins = 0
    user.locked_until = None
    db.commit()
    token, lifetime = create_access_token(user.id, user.role, user.token_version)
    return {"access_token": token, "expires_in": lifetime, "user": user}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    """Invalidate every token issued to this user so far."""
    user.token_version += 1
    db.commit()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.put("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, user: User = Depends(get_current_user),
              db: Session = Depends(get_db)) -> User:
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.email is not None and body.email.lower() != user.email:
        if not body.current_password or not verify_password(body.current_password,
                                                             user.hashed_password):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Enter your current password to change your email.")
        email = body.email.lower()
        if db.scalar(select(User).where(User.email == email)):
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "An account with this email already exists.")
        user.email = email
    db.commit()
    return user


@router.post("/change-password", response_model=TokenResponse)
def change_password(body: PasswordChange, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> dict:
    """Ends all other sessions, and returns a new token for this one."""
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your current password is incorrect.")
    user.hashed_password = hash_password(body.new_password)
    user.token_version += 1
    audit(db, user, "user.password_changed", "user", user.id)
    db.commit()
    token, lifetime = create_access_token(user.id, user.role, user.token_version)
    return {"access_token": token, "expires_in": lifetime, "user": user}
