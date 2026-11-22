from datetime import timedelta

import bcrypt
import jwt

from app.config import get_settings
from app.database import utcnow

ALGORITHM = "HS256"

# Verified when an email is unknown, so response time does not reveal which emails exist.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser", bcrypt.gensalt()).decode()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str | None) -> bool:
    encoded = password.encode()
    # bcrypt only accepts 72 bytes. Registration enforces this, so longer input cannot match.
    if len(encoded) > 72:
        encoded = encoded[:72]
        hashed = None
    matched = bcrypt.checkpw(encoded, (hashed or _DUMMY_HASH).encode())
    return matched and hashed is not None


def create_access_token(user_id: int, role: str, token_version: int) -> tuple[str, int]:
    settings = get_settings()
    now = utcnow()
    lifetime = settings.access_token_expire_minutes * 60
    payload = {
        "sub": str(user_id),
        "role": role,
        "ver": token_version,
        "iat": now,
        "exp": now + timedelta(seconds=lifetime),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM), lifetime


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError for an invalid or expired token."""
    return jwt.decode(
        token,
        get_settings().secret_key,
        algorithms=[ALGORITHM],
        options={"require": ["exp", "sub", "ver"]},
    )
