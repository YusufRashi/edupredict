from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models import User
from app.schemas import SettingsOut, SettingsUpdate
from app.services.common import all_settings, audit, set_setting

router = APIRouter(prefix="/settings", tags=["Settings (admin)"])


@router.get("", response_model=SettingsOut)
def read_settings(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    return all_settings(db)


@router.put("", response_model=SettingsOut)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db),
                    admin: User = Depends(require_admin)) -> dict:
    for key, value in body.model_dump(exclude_none=True).items():
        set_setting(db, key, value, admin)
        audit(db, admin, "settings.updated", "setting", key, f"value={value}")
    db.commit()
    return all_settings(db)
