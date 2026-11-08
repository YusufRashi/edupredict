from conftest import FEATURES
from sqlalchemy import func, select

from app.models import AcademicRecommendation, AcademicRecord, AuditLog, Prediction


def test_create_read_update_delete(educator):
    created = educator.http.post("/api/students", json={
        "student_code": "A-100", "full_name": "Ada Learner", "email": "Ada@Example.com",
        "year_group": "Year 10"})
    assert created.status_code == 201
    student_id = created.json()["id"]
    assert created.json()["email"] == "ada@example.com"

    updated = educator.http.put(f"/api/students/{student_id}", json={
        "student_code": "A-100", "full_name": "Ada Lovelace", "year_group": "Year 11"})
    assert updated.status_code == 200
    assert educator.http.get(f"/api/students/{student_id}").json()["full_name"] == "Ada Lovelace"

    assert educator.http.delete(f"/api/students/{student_id}").status_code == 204
    assert educator.http.get(f"/api/students/{student_id}").status_code == 404


def test_duplicate_code_is_rejected(educator):
    body = {"student_code": "DUP-1", "full_name": "One"}
    assert educator.http.post("/api/students", json=body).status_code == 201
    assert educator.http.post("/api/students", json=body).status_code == 409


def test_validation_rejects_bad_input(educator):
    for body in [{"student_code": "bad code!", "full_name": "X"},
                 {"student_code": "OK-1", "full_name": "   "},
                 {"student_code": "OK-2", "full_name": "=HYPERLINK(1)"},
                 {"student_code": "OK-3", "full_name": "X", "email": "not-an-email"}]:
        assert educator.http.post("/api/students", json=body).status_code == 422, body


def test_search_filter_and_pagination(educator, make_student):
    for index in range(5):
        make_student(f"PAGE-{index}")
    make_student("OTHER-9", subject="portuguese")

    page = educator.http.get("/api/students", params={"page": 2, "page_size": 2}).json()
    assert (page["total"], page["page"], page["pages"], len(page["items"])) == (6, 2, 3, 2)

    found = educator.http.get("/api/students", params={"q": "other-9"}).json()
    assert [s["student_code"] for s in found["items"]] == ["OTHER-9"]

    by_subject = educator.http.get("/api/students", params={"subject": "portuguese"}).json()
    assert by_subject["total"] == 1

    assert educator.http.get("/api/students", params={"q": "%"}).json()["total"] == 0
    assert educator.http.get("/api/students", params={"page_size": 1000}).status_code == 422


def test_risk_filter_uses_latest_prediction(educator, make_student):
    student = make_student("RISK-1")
    run = {"stage": "period2", "student_id": student["id"]}
    educator.http.post("/api/predictions",
                       json={**run, "features": {**FEATURES, "G1": 3, "G2": 3}})
    params = {"risk_level": "high"}
    assert educator.http.get("/api/students", params=params).json()["total"] == 1

    educator.http.post("/api/predictions",
                       json={**run, "features": {**FEATURES, "G1": 18, "G2": 18}})
    assert educator.http.get("/api/students", params=params).json()["total"] == 0
    listed = educator.http.get("/api/students", params={"risk_level": "low"}).json()
    assert listed["items"][0]["highest_risk"] == "low"


def test_records_crud_and_constraints(educator, make_student):
    student = make_student("REC-1")
    url = f"/api/students/{student['id']}/records"
    record_id = student["record"]["id"]
    duplicate = {"subject": "math", "academic_year": "2025/26"}
    assert educator.http.post(url, json=duplicate).status_code == 409
    assert educator.http.post(url, json={**duplicate, "academic_year": "next"}).status_code == 422
    assert educator.http.post(url, json={"subject": "math", "academic_year": "2024",
                                         "final_grade": 21}).status_code == 422
    assert educator.http.post(url, json={"subject": "history",
                                         "academic_year": "2024"}).status_code == 422

    updated = educator.http.put(f"{url}/{record_id}", json={
        "subject": "math", "academic_year": "2025/26", "final_grade": 15})
    assert updated.json()["final_grade"] == 15
    assert educator.http.delete(f"{url}/{record_id}").status_code == 204
    assert educator.http.delete(f"{url}/{record_id}").status_code == 404


def test_record_from_another_student_is_not_reachable(educator, make_student):
    first, second = make_student("A-1"), make_student("B-1")
    url = f"/api/students/{second['id']}/records/{first['record']['id']}"
    assert educator.http.delete(url).status_code == 404


def test_linking_rules(educator, admin, student_user, make_student):
    make_student("LINK-1", linked=student_user.email)
    body = {"student_code": "LINK-2", "full_name": "Two"}
    taken = educator.http.post("/api/students",
                               json={**body, "linked_user_email": student_user.email})
    assert taken.status_code == 409
    not_student = educator.http.post("/api/students",
                                     json={**body, "linked_user_email": admin.email})
    assert not_student.status_code == 422


def test_deleting_a_student_removes_all_their_data(educator, make_student, db):
    student = make_student("GONE-1")
    educator.http.post("/api/predictions", json={
        "stage": "period2", "student_id": student["id"], "features": FEATURES})
    assert db.scalar(select(func.count()).select_from(Prediction)) == 1

    assert educator.http.delete(f"/api/students/{student['id']}").status_code == 204
    for model in (Prediction, AcademicRecord, AcademicRecommendation):
        assert db.scalar(select(func.count()).select_from(model)) == 0


def test_changes_are_audited_without_student_details(educator, make_student, db):
    make_student("AUD-1")
    logs = db.scalars(select(AuditLog)).all()
    assert {"student.created", "record.created"} <= {log.action for log in logs}
    assert all("Learner" not in (log.detail or "") for log in logs)


def test_educator_recommendations(educator, make_student):
    student = make_student("ADV-1")
    url = f"/api/students/{student['id']}/recommendations"
    created = educator.http.post(url, json={"title": "See me", "message": "Let's talk."})
    assert created.status_code == 201
    assert created.json()["source"] == "educator"
    assert created.json()["shared_with_student"] is False
    done = educator.http.patch(f"{url}/{created.json()['id']}", json={"status": "completed"})
    assert done.json()["status"] == "completed"
    assert educator.http.delete(f"{url}/{created.json()['id']}").status_code == 204
