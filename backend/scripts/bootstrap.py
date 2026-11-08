"""Create the first admin and, only when enabled, demonstration data.

Run from backend/:  python -m scripts.bootstrap

Safe to run on every start: anything that already exists is left alone.

Demonstration students are real rows from the held-out UCI test split, so the models
never trained on them. The dataset has no names, so they get pseudonyms such as
"Demo Student 0042", and everything created here is flagged is_demo. Their predictions
are genuine model output at the "after first period" stage. All timestamps are the
real time of seeding: no history is invented.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import PLACEHOLDER, get_settings
from app.database import SessionLocal
from app.models import AcademicRecord, Student, User
from app.schemas import check_password
from app.security import hash_password
from app.services.common import audit
from app.services.predictions import (
    create_prediction,
    get_pipeline,
    record_features,
    sync_model_versions,
)
from ml.data import group_split, load_clean

logger = logging.getLogger("edupredict.bootstrap")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

DEMO_EDUCATOR_EMAIL = "educator@edupredict.demo"
DEMO_STUDENT_EMAIL = "student@edupredict.demo"
DEMO_YEAR = "2005/06"  # when the UCI data was collected
DEMO_STAGE = "period1"


def ensure_admin(db: Session) -> None:
    settings = get_settings()
    if not settings.first_admin_email or not settings.first_admin_password:
        logger.info("FIRST_ADMIN_EMAIL or FIRST_ADMIN_PASSWORD not set: skipping admin creation.")
        return
    if PLACEHOLDER in settings.first_admin_password:
        raise SystemExit("FIRST_ADMIN_PASSWORD still has its placeholder value. Change it in .env.")
    email = settings.first_admin_email.lower()
    if db.scalar(select(User).where(User.email == email)) is None:
        admin = User(email=email, full_name="System Administrator", role="admin",
                     hashed_password=hash_password(check_password(settings.first_admin_password)))
        db.add(admin)
        db.flush()
        audit(db, admin, "user.created", "user", admin.id, "first admin")
        db.commit()
        logger.info("Created first admin account.")


def _ensure_user(db: Session, email: str, name: str, role: str, password_hash: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, full_name=name, role=role, hashed_password=password_hash)
        db.add(user)
        db.flush()
    return user


def seed_demo(db: Session) -> None:
    settings = get_settings()
    if db.scalar(select(Student).where(Student.is_demo.is_(True)).limit(1)) is not None:
        logger.info("Demo data already present.")
        return
    if not settings.demo_password or PLACEHOLDER in settings.demo_password:
        raise SystemExit("SEED_DEMO_DATA is true, so DEMO_PASSWORD must be set to a real value.")
    password_hash = hash_password(check_password(settings.demo_password))
    educator = _ensure_user(db, DEMO_EDUCATOR_EMAIL, "Demo Educator", "educator", password_hash)
    student_user = _ensure_user(db, DEMO_STUDENT_EMAIL, "Demo Student", "student", password_hash)

    frame, _ = load_clean()
    test = group_split(frame).test
    pipeline = get_pipeline()
    sync_model_versions(db, pipeline)

    # One student per identity key. If two rows share a key and a subject, they must be
    # two different people, since nobody takes the same course twice in this data.
    by_group: dict[str, list[Student]] = {}
    subjects: dict[int, set[str]] = {}
    number = 0
    for row in test.sort_values(["student_group", "subject"]).itertuples():
        candidates = by_group.setdefault(row.student_group, [])
        student = next((s for s in candidates if row.subject not in subjects[s.id]), None)
        if student is None:
            number += 1
            student = Student(student_code=f"DEMO-{number:04d}",
                              full_name=f"Demo Student {number:04d}",
                              year_group="Demo cohort", is_demo=True)
            db.add(student)
            db.flush()
            candidates.append(student)
            subjects[student.id] = set()
        subjects[student.id].add(row.subject)

        record = AcademicRecord(
            student_id=student.id, subject=row.subject, academic_year=DEMO_YEAR,
            period1_grade=int(row.G1), period2_grade=int(row.G2), final_grade=int(row.G3),
            absences=int(row.absences), study_time=int(row.studytime),
            past_failures=min(int(row.failures), 3), school_support=row.schoolsup == "yes",
            activities=row.activities == "yes", wants_higher_education=row.higher == "yes",
        )
        db.add(record)
        db.flush()
        create_prediction(db, pipeline, stage=DEMO_STAGE, features=record_features(record),
                          actor=educator, student=student, record=record,
                          share_recommendations=True, is_demo=True)

    # Link the demo login to a student taking both courses, if there is one.
    linked = next((s for group in by_group.values() for s in group if len(subjects[s.id]) == 2),
                  next(s for group in by_group.values() for s in group))
    linked.user_id = student_user.id
    audit(db, None, "demo.seeded", "student", None, f"students={number}, rows={len(test)}")
    db.commit()
    logger.info("Seeded %s demo students from %s held-out rows.", number, len(test))


def main() -> None:
    with SessionLocal() as db:
        ensure_admin(db)
        if get_settings().seed_demo_data:
            seed_demo(db)


if __name__ == "__main__":
    main()
