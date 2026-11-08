"""Role-based access control across the API."""

import pytest
from conftest import FEATURES

from app.main import app

PUBLIC = {("POST", "/api/auth/register"), ("POST", "/api/auth/login"), ("GET", "/api/health")}


def all_routes():
    """Taken from the OpenAPI schema, because app.routes does not expose included routers."""
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            yield method.upper(), path


def test_route_list_is_not_empty():
    assert len(list(all_routes())) > 40


@pytest.mark.parametrize("method,path", sorted(set(all_routes()) - PUBLIC))
def test_every_non_public_route_rejects_anonymous_requests(client, method, path):
    url = path
    for name in ("student_id", "record_id", "recommendation_id", "prediction_id", "dataset_id",
                 "user_id"):
        url = url.replace("{" + name + "}", "1")
    assert client.request(method, url).status_code == 401


STAFF_ONLY_GET = [
    "/api/students", "/api/students/year-groups", "/api/predictions", "/api/predictions/options",
    "/api/analytics/overview", "/api/analytics/performance", "/api/analytics/distribution",
    "/api/analytics/trends", "/api/analytics/attention", "/api/model/info", "/api/model/metrics",
    "/api/model/versions", "/api/reports/performance", "/api/reports/risk",
]
ADMIN_ONLY_GET = ["/api/users", "/api/settings", "/api/analytics/system"]


@pytest.mark.parametrize("path", STAFF_ONLY_GET + ADMIN_ONLY_GET + ["/api/datasets"])
def test_students_cannot_read_staff_endpoints(student_user, path):
    assert student_user.http.get(path).status_code == 403


@pytest.mark.parametrize("path", ADMIN_ONLY_GET)
def test_educators_cannot_read_admin_endpoints(educator, path):
    assert educator.http.get(path).status_code == 403


@pytest.mark.parametrize("path", STAFF_ONLY_GET)
def test_educators_and_admins_can_read_staff_endpoints(educator, admin, path):
    assert educator.http.get(path).status_code == 200
    assert admin.http.get(path).status_code == 200


def test_students_cannot_write(student_user, make_student):
    student = make_student()
    url = f"/api/students/{student['id']}"
    http = student_user.http
    new_student = {"student_code": "X", "full_name": "X"}
    assert http.post("/api/students", json=new_student).status_code == 403
    assert http.put(url, json={"student_code": "X", "full_name": "X"}).status_code == 403
    assert http.delete(url).status_code == 403
    assert http.post(f"{url}/records", json={"subject": "math",
                                             "academic_year": "2025"}).status_code == 403
    assert http.post("/api/predictions", json={"stage": "period2",
                                               "features": FEATURES}).status_code == 403


def test_student_sees_own_record_only(student_user, make_student):
    own = make_student("OWN-1", linked=student_user.email)
    other = make_student("OTHER-1")
    assert student_user.http.get(f"/api/students/{own['id']}").status_code == 200
    assert student_user.http.get("/api/students/me").json()["id"] == own["id"]
    assert student_user.http.get(f"/api/students/{other['id']}").status_code == 404
    assert student_user.http.get("/api/students/999999").status_code == 404


def test_unlinked_student_gets_404_from_me(student_user):
    assert student_user.http.get("/api/students/me").status_code == 404


def test_student_never_sees_predictions_or_unshared_advice(student_user, educator, make_student):
    student = make_student("OWN-2", linked=student_user.email)
    response = educator.http.post("/api/predictions", json={
        "stage": "period2", "student_id": student["id"],
        "features": {**FEATURES, "G1": 4, "G2": 4},
    })
    assert response.status_code == 201
    staff_view = educator.http.get(f"/api/students/{student['id']}").json()
    assert staff_view["latest_predictions"]
    advice = staff_view["recommendations"]
    assert advice

    view = student_user.http.get("/api/students/me").json()
    assert view["latest_predictions"] == []
    assert view["recommendations"] == []
    assert view["linked_user_email"] is None

    educator.http.patch(f"/api/students/{student['id']}/recommendations/{advice[0]['id']}",
                        json={"shared_with_student": True})
    view = student_user.http.get("/api/students/me").json()
    assert [item["id"] for item in view["recommendations"]] == [advice[0]["id"]]
    assert "risk" not in view["recommendations"][0]["message"].lower()


def test_educator_cannot_manage_users_or_settings(educator):
    assert educator.http.post("/api/users", json={
        "email": "x@example.com", "full_name": "X", "password": "ValidPass123", "role": "admin",
    }).status_code == 403
    assert educator.http.put("/api/settings", json={
        "educators_can_upload_datasets": True}).status_code == 403


def test_admin_manages_users(admin, make_user):
    created = admin.http.post("/api/users", json={
        "email": "teacher@example.com", "full_name": "Teacher", "password": "ValidPass123",
        "role": "educator"})
    assert created.status_code == 201
    user_id = created.json()["id"]
    changed = admin.http.put(f"/api/users/{user_id}", json={"role": "student"})
    assert changed.json()["role"] == "student"
    found = admin.http.get("/api/users", params={"q": "teacher@", "role": "student"}).json()
    assert found["total"] == 1


def test_role_change_applies_immediately(admin, educator):
    assert educator.http.get("/api/students").status_code == 200
    admin.http.put(f"/api/users/{educator.id}", json={"role": "student"})
    assert educator.http.get("/api/students").status_code == 403


def test_last_admin_is_protected(admin):
    assert admin.http.put(f"/api/users/{admin.id}", json={"role": "student"}).status_code == 409
    assert admin.http.put(f"/api/users/{admin.id}", json={"is_active": False}).status_code == 409
    assert admin.http.delete(f"/api/users/{admin.id}").status_code == 409


def test_every_response_has_security_headers(client):
    headers = client.get("/api/health").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
