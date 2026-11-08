"""Authentication and authorization dependencies shared by every route."""

from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Student, User
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail,
                         headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise _unauthorized("Not authenticated.")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("Your session has expired. Please log in again.") from exc
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise _unauthorized("Invalid authentication token.") from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized("This account is not available.")
    if payload["ver"] != user.token_version:
        raise _unauthorized("Your session has ended. Please log in again.")
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    """The role is read from the database, so a role change applies immediately."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "You do not have permission to do this.")
        return user

    return checker


require_staff = require_roles("admin", "educator")
require_admin = require_roles("admin")


def get_student_or_404(db: Session, student_id: int) -> Student:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")
    return student
