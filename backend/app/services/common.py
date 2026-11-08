"""Small helpers: pagination, audit logging and system settings."""

import math

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AuditLog, SystemSetting, User

DEFAULT_SETTINGS = {
    "allow_public_registration": True,
    "educators_can_upload_datasets": False,
}


def paginate(db: Session, statement, page: int, page_size: int) -> tuple[list, int, int]:
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    items = db.scalars(statement.limit(page_size).offset((page - 1) * page_size)).all()
    return list(items), total, max(1, math.ceil(total / page_size))


def like_pattern(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def audit(db: Session, actor: User | None, action: str, entity_type: str | None = None,
          entity_id: object = None, detail: str | None = None) -> None:
    """Adds to the current transaction, so the audit entry commits with the change."""
    db.add(AuditLog(actor_id=actor.id if actor else None, action=action, entity_type=entity_type,
                    entity_id=None if entity_id is None else str(entity_id), detail=detail))


def get_setting(db: Session, key: str) -> bool:
    row = db.get(SystemSetting, key)
    return DEFAULT_SETTINGS[key] if row is None else row.value


def all_settings(db: Session) -> dict:
    return {key: get_setting(db, key) for key in DEFAULT_SETTINGS}


def set_setting(db: Session, key: str, value: bool, actor: User) -> None:
    row = db.get(SystemSetting, key)
    if row is None:
        db.add(SystemSetting(key=key, value=value, updated_by_id=actor.id))
    else:
        row.value = value
        row.updated_by_id = actor.id
