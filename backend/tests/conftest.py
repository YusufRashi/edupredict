"""Test fixtures. Uses SQLite by default; set TEST_DATABASE_URL to run against PostgreSQL."""

import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="edupredict-tests-"))
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp / 'test.db'}")
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-for-hs256-signing"
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["SEED_DEMO_DATA"] = "false"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
os.environ["MAX_UPLOAD_BYTES"] = "20000"
os.environ["MAX_UPLOAD_ROWS"] = "50"

import bcrypt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

_real_gensalt = bcrypt.gensalt
bcrypt.gensalt = lambda rounds=4, prefix=b"2b": _real_gensalt(rounds=4, prefix=prefix)

from app import models  # noqa: E402,F401
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402

PASSWORD = "CorrectHorse42"
FEATURES = {"subject": "math", "studytime": 2, "failures": 0, "absences": 4, "schoolsup": "no",
            "activities": "yes", "higher": "yes", "G1": 12, "G2": 13}


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    engine.dispose()


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    return TestClient(app)


class Actor:
    """A logged-in user: an API client that sends that user's token."""

    def __init__(self, user_id: int, email: str, token: str):
        self.id, self.email, self.token = user_id, email, token
        self.http = TestClient(app, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture
def make_user(client):
    def factory(role: str = "student", email: str | None = None) -> Actor:
        email = email or f"{role}{os.urandom(3).hex()}@example.com"
        with SessionLocal() as session:
            user = User(email=email, full_name=f"Test {role.title()}", role=role,
                        hashed_password=hash_password(PASSWORD))
            session.add(user)
            session.commit()
            user_id = user.id
        response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text
        return Actor(user_id, email, response.json()["access_token"])

    return factory


@pytest.fixture
def admin(make_user):
    return make_user("admin")


@pytest.fixture
def educator(make_user):
    return make_user("educator")


@pytest.fixture
def student_user(make_user):
    return make_user("student")


@pytest.fixture
def make_student(educator):
    def factory(code: str = "S-1", linked: str | None = None, **record) -> dict:
        response = educator.http.post("/api/students", json={
            "student_code": code, "full_name": f"Learner {code}", "year_group": "Year 11",
            "linked_user_email": linked,
        })
        assert response.status_code == 201, response.text
        student = response.json()
        body = {"subject": "math", "academic_year": "2025/26", "period1_grade": 12,
                "period2_grade": 11, "final_grade": 12, **record}
        response = educator.http.post(f"/api/students/{student['id']}/records", json=body)
        assert response.status_code == 201, response.text
        student["record"] = response.json()
        return student

    return factory
