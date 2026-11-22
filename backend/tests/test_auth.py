from datetime import timedelta

import jwt
from conftest import PASSWORD
from sqlalchemy import select

from app.config import get_settings
from app.database import utcnow
from app.models import User
from app.security import ALGORITHM, verify_password

NEW_USER = {"email": "New.Person@Example.com", "full_name": "New Person",
            "password": "ValidPass123"}


def test_register_creates_student_with_hashed_password(client, db):
    response = client.post("/api/auth/register", json=NEW_USER)
    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "student"
    assert body["email"] == "new.person@example.com"
    assert "password" not in response.text and "hashed" not in response.text
    stored = db.scalar(select(User).where(User.email == "new.person@example.com"))
    assert stored.hashed_password != NEW_USER["password"]
    assert stored.hashed_password.startswith("$2b$")
    assert verify_password(NEW_USER["password"], stored.hashed_password)


def test_register_cannot_choose_a_role(client):
    response = client.post("/api/auth/register", json={**NEW_USER, "role": "admin"})
    assert response.status_code == 201
    assert response.json()["role"] == "student"


def test_register_rejects_duplicate_email_in_any_case(client):
    client.post("/api/auth/register", json=NEW_USER)
    response = client.post("/api/auth/register",
                           json={**NEW_USER, "email": "NEW.PERSON@example.com"})
    assert response.status_code == 409


def test_register_rejects_weak_passwords(client):
    for password in ["short1", "onlyletterslong", "12345678901", "a1" * 40]:
        response = client.post("/api/auth/register", json={**NEW_USER, "password": password})
        assert response.status_code == 422, password


def test_register_can_be_turned_off(client, admin):
    admin.http.put("/api/settings", json={"allow_public_registration": False})
    assert client.post("/api/auth/register", json=NEW_USER).status_code == 403


def test_login_and_me(client, educator):
    response = client.post("/api/auth/login", json={"email": educator.email, "password": PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert educator.http.get("/api/auth/me").json()["email"] == educator.email


def test_login_failure_does_not_reveal_whether_email_exists(client, educator):
    wrong = client.post("/api/auth/login", json={"email": educator.email, "password": "nope"})
    unknown = client.post("/api/auth/login", json={"email": "no@example.com", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_account_locks_after_repeated_failures(client, educator):
    for _ in range(get_settings().max_failed_logins):
        client.post("/api/auth/login", json={"email": educator.email, "password": "wrong"})
    response = client.post("/api/auth/login", json={"email": educator.email, "password": PASSWORD})
    assert response.status_code == 429


def test_lock_expires(client, educator, db):
    user = db.get(User, educator.id)
    user.locked_until = utcnow() - timedelta(minutes=1)
    db.commit()
    response = client.post("/api/auth/login", json={"email": educator.email, "password": PASSWORD})
    assert response.status_code == 200


def test_deactivated_user_cannot_log_in_and_token_stops_working(client, admin, educator):
    assert admin.http.delete(f"/api/users/{educator.id}").status_code == 200
    assert educator.http.get("/api/auth/me").status_code == 401
    response = client.post("/api/auth/login", json={"email": educator.email, "password": PASSWORD})
    assert response.status_code == 403


def test_logout_invalidates_the_token(educator):
    assert educator.http.post("/api/auth/logout").status_code == 204
    assert educator.http.get("/api/auth/me").status_code == 401


def _token(claims: dict, secret: str | None = None) -> str:
    return jwt.encode(claims, secret or get_settings().secret_key, algorithm=ALGORITHM)


def test_expired_token_is_rejected_with_clear_message(client, educator):
    token = _token({"sub": str(educator.id), "ver": 0, "exp": utcnow() - timedelta(minutes=1)})
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert "expired" in response.json()["detail"]


def test_forged_and_malformed_tokens_are_rejected(client, educator):
    claims = {"sub": str(educator.id), "ver": 0, "exp": utcnow() + timedelta(minutes=5)}
    forged = _token(claims, "another-secret-key-that-is-also-long-enough-to-sign")
    unsigned = jwt.encode(claims, "", algorithm="none")
    no_expiry = _token({"sub": str(educator.id), "ver": 0})
    for token in [forged, unsigned, no_expiry, "garbage"]:
        response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 401, token


def test_role_in_a_token_is_not_trusted(client, student_user):
    token = _token({"sub": str(student_user.id), "ver": 0, "role": "admin",
                    "exp": utcnow() + timedelta(minutes=5)})
    response = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_profile_update(educator):
    response = educator.http.put("/api/auth/me", json={"full_name": "Renamed"})
    assert response.json()["full_name"] == "Renamed"


def test_changing_email_needs_current_password(educator):
    body = {"email": "moved@example.com"}
    assert educator.http.put("/api/auth/me", json=body).status_code == 403
    response = educator.http.put("/api/auth/me", json={**body, "current_password": PASSWORD})
    assert response.json()["email"] == "moved@example.com"


def test_change_password_ends_old_sessions(client, educator):
    response = educator.http.post("/api/auth/change-password", json={
        "current_password": PASSWORD, "new_password": "BrandNewPass99"})
    assert response.status_code == 200
    assert educator.http.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": educator.email,
                                                "password": "BrandNewPass99"}).status_code == 200


def test_change_password_requires_current(educator):
    response = educator.http.post("/api/auth/change-password", json={
        "current_password": "wrong", "new_password": "BrandNewPass99"})
    assert response.status_code == 403
