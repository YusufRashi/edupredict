import csv
import io

from conftest import FEATURES
from sqlalchemy import select

from app.models import AuditLog
from app.routes.reports import safe_cell
from scripts.bootstrap import DEMO_STUDENT_EMAIL, seed_demo


def predict(educator, student, g1=12, g2=12):
    return educator.http.post("/api/predictions", json={
        "stage": "period2", "student_id": student["id"],
        "academic_record_id": student["record"]["id"],
        "features": {**FEATURES, "G1": g1, "G2": g2}}).json()


def test_overview_of_an_empty_system_is_honest(educator):
    body = educator.http.get("/api/analytics/overview").json()
    assert body["total_students"] == 0
    assert body["average_final_grade"] is None
    assert body["pass_rate"] is None


def test_overview_counts_match_the_data(educator, make_student):
    make_student("A-1", final_grade=15)
    make_student("A-2", final_grade=5)
    weak = make_student("A-3", final_grade=None)
    predict(educator, weak, 2, 2)
    body = educator.http.get("/api/analytics/overview").json()
    assert body["total_students"] == 3
    assert body["total_records"] == 3
    assert body["final_grades_recorded"] == 2
    assert body["average_final_grade"] == 10
    assert body["pass_rate"] == 0.5
    assert body["total_predictions"] == 1
    assert body["students_needing_attention"] == 1
    assert body["risk_distribution"] == {"low": 0, "moderate": 0, "high": 1}


def test_risk_counts_only_the_latest_prediction(educator, make_student):
    student = make_student("A-4")
    predict(educator, student, 2, 2)
    predict(educator, student, 18, 18)
    body = educator.http.get("/api/analytics/overview").json()
    assert body["total_predictions"] == 2
    assert body["risk_distribution"] == {"low": 1, "moderate": 0, "high": 0}
    assert body["students_needing_attention"] == 0


def test_performance_by_subject(educator, make_student):
    make_student("B-1", final_grade=10, period1_grade=8)
    make_student("B-2", final_grade=20, period1_grade=12)
    make_student("B-3", subject="portuguese", final_grade=6)
    subjects = {s["subject"]: s for s in
                educator.http.get("/api/analytics/performance").json()["subjects"]}
    assert subjects["math"]["average_final"] == 15
    assert subjects["math"]["average_period1"] == 10
    assert subjects["math"]["pass_rate"] == 1
    assert subjects["portuguese"]["pass_rate"] == 0


def test_distribution_histogram_and_filter(educator, make_student):
    make_student("C-1", final_grade=10)
    make_student("C-2", subject="portuguese", final_grade=10)
    grades = educator.http.get("/api/analytics/distribution").json()["grades"]
    assert len(grades) == 21
    assert grades[10] == {"grade": 10, "math": 1, "portuguese": 1}
    only = educator.http.get("/api/analytics/distribution",
                             params={"subject": "math"}).json()["grades"]
    assert only[10] == {"grade": 10, "math": 1, "portuguese": 0}


def test_trends(educator, make_student):
    student = make_student("D-1", period1_grade=8, period2_grade=10, final_grade=12)
    predict(educator, student)
    body = educator.http.get("/api/analytics/trends").json()
    assert [p["math"] for p in body["grades_by_period"]] == [8, 10, 12]
    assert sum(day["count"] for day in body["predictions_per_day"]) == 1


def test_attention_is_sorted_and_excludes_low(educator, make_student):
    weak, weaker, strong = make_student("E-1"), make_student("E-2"), make_student("E-3")
    predict(educator, weak, 8, 8)
    predict(educator, weaker, 1, 1)
    predict(educator, strong, 19, 19)
    rows = educator.http.get("/api/analytics/attention").json()
    assert rows[0]["student_code"] == "E-2"
    assert "E-3" not in {row["student_code"] for row in rows}
    assert rows == sorted(rows, key=lambda r: r["risk_probability"], reverse=True)


def test_system_overview(admin, educator):
    body = admin.http.get("/api/analytics/system").json()
    assert body["users_by_role"]["educator"] == 1
    assert body["database_status"] == "connected"


def parse_csv(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def test_performance_report_json_and_csv_agree(educator, make_student):
    make_student("F-1", final_grade=15)
    make_student("F-2", final_grade=4)
    report = educator.http.get("/api/reports/performance").json()
    assert report["total"] == 2
    assert report["disclaimer"]
    response = educator.http.get("/api/reports/performance", params={"format": "csv"})
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    rows = parse_csv(response.text)
    assert [r["student_code"] for r in rows] == [r["student_code"] for r in report["rows"]]
    assert {r["result"] for r in rows} == {"pass", "below pass"}
    assert {r["data_type"] for r in rows} == {"institution"}


def test_performance_report_filters(educator, make_student):
    student = make_student("G-1")
    make_student("G-2", subject="portuguese")
    assert educator.http.get("/api/reports/performance",
                             params={"subject": "portuguese"}).json()["total"] == 1
    single = educator.http.get("/api/reports/performance", params={"student_id": student["id"]})
    assert [r["student_code"] for r in single.json()["rows"]] == ["G-1"]


def test_risk_report(educator, make_student):
    predict(educator, make_student("H-1", final_grade=4), 2, 2)
    predict(educator, make_student("H-2", final_grade=18), 19, 19)
    report = educator.http.get("/api/reports/risk", params={"risk_level": "high"}).json()
    assert [r["student_code"] for r in report["rows"]] == ["H-1"]
    assert report["rows"][0]["actual_final_grade"] == 4
    rows = parse_csv(educator.http.get("/api/reports/risk", params={"format": "csv"}).text)
    assert len(rows) == 2


def test_exports_are_audited(educator, db):
    educator.http.get("/api/reports/risk", params={"format": "csv"})
    assert db.scalar(select(AuditLog).where(AuditLog.action == "report.risk.csv"))


def test_csv_cells_cannot_run_as_formulas():
    assert safe_cell("=1+1") == "'=1+1"
    assert safe_cell("@SUM(A1)") == "'@SUM(A1)"
    assert safe_cell("Ana") == "Ana"
    assert safe_cell(12) == 12


class TestDemoSeed:
    def test_seed_is_flagged_real_and_idempotent(self, db, educator, monkeypatch):
        monkeypatch.setattr("scripts.bootstrap.get_settings", lambda: _Settings())
        seed_demo(db)
        overview = educator.http.get("/api/analytics/overview").json()
        assert overview["total_students"] == overview["demo_students"] > 100
        assert overview["total_predictions"] == overview["demo_predictions"] == 209
        assert educator.http.get("/api/students",
                                 params={"is_demo": False}).json()["total"] == 0

        seed_demo(db)
        again = educator.http.get("/api/analytics/overview").json()
        assert again["total_predictions"] == 209

        report = educator.http.get("/api/reports/risk").json()
        assert report["demo_rows"] == report["total"]
        assert {row["data_type"] for row in report["rows"]} == {"demonstration"}

    def test_demo_login_sees_only_shared_records(self, db, client, monkeypatch):
        monkeypatch.setattr("scripts.bootstrap.get_settings", lambda: _Settings())
        seed_demo(db)
        token = client.post("/api/auth/login", json={
            "email": DEMO_STUDENT_EMAIL, "password": _Settings.demo_password,
        }).json()["access_token"]
        view = client.get("/api/students/me",
                          headers={"Authorization": f"Bearer {token}"}).json()
        assert view["is_demo"] is True
        assert view["records"]
        assert view["latest_predictions"] == []
        assert view["recommendations"]


class _Settings:
    demo_password = "DemoPassword123"
    secret_key = "x" * 40
