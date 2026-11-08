import csv
import io

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models import AcademicRecord, Dataset, Student
from app.services.datasets import TEMPLATE_COLUMNS, template_csv, validate_csv


def row(**overrides) -> dict:
    return {"student_code": "S-1", "full_name": "Ana Silva", "year_group": "Year 11",
            "subject": "math", "academic_year": "2025/26", "period1_grade": "12",
            "period2_grade": "11", "final_grade": "", "absences": "3", "study_time": "2",
            "past_failures": "0", "school_support": "no", "activities": "yes",
            "wants_higher_education": "yes", **overrides}


def make_csv(rows: list[dict]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=TEMPLATE_COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode()


def upload(actor, content: bytes, filename="data.csv", content_type="text/csv", **data):
    files = {"file": (filename, content, content_type)}
    return actor.http.post("/api/datasets/upload", files=files, data=data)


class TestValidation:
    def test_template_is_itself_valid(self):
        assert validate_csv(template_csv().encode(), 50)["valid"]

    def test_good_file_gets_a_profile(self):
        report = validate_csv(make_csv([row(), row(student_code="S-2", final_grade="14")]), 50)
        assert report["valid"]
        assert report["profile"]["distinct_students"] == 2
        assert report["profile"]["average_final_grade"] == 14
        assert report["profile"]["missing_by_column"]["final_grade"] == 1

    @pytest.mark.parametrize("field,value", [
        ("student_code", "bad code"), ("full_name", ""), ("full_name", "=CMD()"),
        ("full_name", "@SUM(A1)"), ("subject", "history"), ("academic_year", "soon"),
        ("period1_grade", "21"), ("period1_grade", "abc"), ("period1_grade", "12.5"),
        ("absences", ""), ("absences", "-1"), ("study_time", "9"), ("past_failures", "4"),
        ("school_support", "maybe"),
    ])
    def test_bad_values_are_found_with_line_and_column(self, field, value):
        report = validate_csv(make_csv([row(), row(**{"student_code": "S-2", field: value})]), 50)
        assert not report["valid"]
        assert report["errors"][0]["line"] == 3
        assert report["errors"][0]["column"] == field

    def test_duplicate_rows_are_rejected(self):
        report = validate_csv(make_csv([row(), row()]), 50)
        assert not report["valid"]
        assert "Duplicate" in report["errors"][0]["message"]

    def test_same_student_in_another_subject_is_fine(self):
        assert validate_csv(make_csv([row(), row(subject="portuguese")]), 50)["valid"]

    @pytest.mark.parametrize("content,message", [
        (b"", "empty"), (b"\x00\x01binary", "text CSV"), (b"\xff\xfe\xfa", "UTF-8"),
        (b"student_code,full_name\nS-1,A\n", "Missing required columns"),
        (",".join(TEMPLATE_COLUMNS).encode() + b"\n", "no data rows"),
    ])
    def test_unusable_files(self, content, message):
        report = validate_csv(content, 50)
        assert not report["valid"]
        assert message in report["file_error"]

    def test_short_and_long_rows_are_caught(self):
        header = ",".join(TEMPLATE_COLUMNS).encode()
        assert not validate_csv(header + b"\nS-1,Ana\n", 50)["valid"]
        long_row = make_csv([row()]).splitlines()[1] + b",extra"
        assert not validate_csv(header + b"\n" + long_row + b"\n", 50)["valid"]

    def test_row_limit(self):
        rows = [row(student_code=f"S-{i}") for i in range(3)]
        assert "more than" in validate_csv(make_csv(rows), 2)["file_error"]

    def test_utf8_bom_from_excel_is_accepted(self):
        assert validate_csv(b"\xef\xbb\xbf" + make_csv([row()]), 50)["valid"]

    def test_error_list_is_capped(self):
        rows = [row(student_code=f"S-{i}", subject="x", study_time="9") for i in range(40)]
        report = validate_csv(make_csv(rows), 50)
        assert report["error_count"] == 80
        assert len(report["errors"]) == 50


class TestPermissions:
    def test_educators_need_permission(self, admin, educator):
        assert upload(educator, make_csv([row()])).status_code == 403
        assert educator.http.get("/api/datasets").status_code == 403
        admin.http.put("/api/settings", json={"educators_can_upload_datasets": True})
        assert upload(educator, make_csv([row()])).status_code == 201
        assert educator.http.get("/api/datasets").json()["total"] == 1

    def test_students_are_refused_even_when_educators_are_allowed(self, admin, student_user):
        admin.http.put("/api/settings", json={"educators_can_upload_datasets": True})
        assert upload(student_user, make_csv([row()])).status_code == 403


class TestUpload:
    def test_valid_file_is_stored_under_a_generated_name(self, admin, db):
        body = upload(admin, make_csv([row()]), filename="../../evil.csv", name="Term 1").json()
        assert body["status"] == "validated"
        assert body["name"] == "Term 1"
        assert body["original_filename"] == "evil.csv"
        dataset = db.get(Dataset, body["id"])
        assert ".." not in dataset.stored_filename and "evil" not in dataset.stored_filename
        assert (get_settings().upload_dir / dataset.stored_filename).exists()

    def test_invalid_file_is_recorded_but_not_kept(self, admin, db):
        body = upload(admin, make_csv([row(subject="x")])).json()
        assert body["status"] == "rejected"
        assert body["validation_report"]["errors"]
        assert db.get(Dataset, body["id"]).stored_filename is None

    @pytest.mark.parametrize("filename,content_type", [
        ("data.exe", "text/csv"), ("data.csv.exe", "text/csv"), ("data.xlsx", "text/csv"),
        ("data.csv", "application/x-msdownload"),
    ])
    def test_wrong_file_types_are_refused(self, admin, filename, content_type):
        assert upload(admin, b"a,b\n", filename, content_type).status_code == 415

    def test_oversized_file_is_refused(self, admin):
        too_big = b"x" * (get_settings().max_upload_bytes + 1)
        assert upload(admin, too_big).status_code == 413

    def test_exact_reupload_is_refused(self, admin):
        content = make_csv([row()])
        assert upload(admin, content).status_code == 201
        assert upload(admin, content).status_code == 409

    def test_report_does_not_echo_row_contents(self, admin):
        body = upload(admin, make_csv([row(full_name="Ana Private")]))
        assert "Ana Private" not in body.text

    def test_template_download(self, admin):
        response = admin.http.get("/api/datasets/template")
        assert response.headers["content-type"].startswith("text/csv")
        assert response.text.startswith("student_code,")


class TestProcessing:
    def test_import_creates_students_and_records(self, admin, db):
        content = make_csv([row(), row(subject="portuguese"), row(student_code="S-2")])
        dataset_id = upload(admin, content).json()["id"]
        body = admin.http.post(f"/api/datasets/{dataset_id}/process").json()
        assert body["status"] == "processed"
        assert body["processing_summary"]["students_created"] == 2
        assert body["processing_summary"]["records_created"] == 3
        assert body["processing_summary"]["predictions_created"] == 0
        student = db.scalar(select(Student).where(Student.student_code == "S-1"))
        assert student.is_demo is False
        assert student.source_dataset_id == dataset_id
        assert len(student.records) == 2

    def test_reimport_updates_without_duplicating(self, admin, db):
        first = upload(admin, make_csv([row()])).json()["id"]
        admin.http.post(f"/api/datasets/{first}/process")
        second = upload(admin, make_csv([row(period1_grade="9")])).json()["id"]
        body = admin.http.post(f"/api/datasets/{second}/process").json()
        assert body["processing_summary"]["records_updated"] == 1
        assert body["processing_summary"]["students_created"] == 0
        assert len(db.scalars(select(Student)).all()) == 1
        assert db.scalar(select(AcademicRecord)).period1_grade == 9

    def test_import_can_run_real_predictions(self, admin):
        content = make_csv([row(), row(student_code="S-2", period1_grade="", period2_grade="")])
        dataset_id = upload(admin, content).json()["id"]
        url = f"/api/datasets/{dataset_id}/process"
        body = admin.http.post(url, params={"run_predictions": True}).json()
        assert body["processing_summary"]["predictions_created"] == 2
        stages = {p["student_code"]: p["stage"] for p in
                  admin.http.get("/api/predictions").json()["items"]}
        assert stages == {"S-1": "period2", "S-2": "intake"}

    def test_cannot_process_twice_or_process_rejected(self, admin):
        dataset_id = upload(admin, make_csv([row()])).json()["id"]
        assert admin.http.post(f"/api/datasets/{dataset_id}/process").status_code == 200
        assert admin.http.post(f"/api/datasets/{dataset_id}/process").status_code == 409
        rejected = upload(admin, make_csv([row(subject="x")])).json()["id"]
        assert admin.http.post(f"/api/datasets/{rejected}/process").status_code == 409

    def test_tampered_file_on_disk_is_not_imported(self, admin, db):
        dataset_id = upload(admin, make_csv([row()])).json()["id"]
        stored = db.get(Dataset, dataset_id).stored_filename
        (get_settings().upload_dir / stored).write_bytes(make_csv([row(subject="x")]))
        assert admin.http.post(f"/api/datasets/{dataset_id}/process").status_code == 409
        assert db.scalars(select(Student)).all() == []

    def test_delete_removes_the_file_but_keeps_students(self, admin, db):
        dataset_id = upload(admin, make_csv([row()])).json()["id"]
        stored = db.get(Dataset, dataset_id).stored_filename
        admin.http.post(f"/api/datasets/{dataset_id}/process")
        assert admin.http.delete(f"/api/datasets/{dataset_id}").status_code == 204
        assert not (get_settings().upload_dir / stored).exists()
        assert admin.http.get(f"/api/datasets/{dataset_id}").status_code == 404
        assert len(db.scalars(select(Student)).all()) == 1
