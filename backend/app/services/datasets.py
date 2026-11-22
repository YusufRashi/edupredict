"""Validate and import uploaded academic data.

Uploads are treated as hostile: size-capped, parsed as plain text only, never
stored under a user-supplied name, and rejected outright if any row is invalid.
"""

import csv
import io
import re
from collections import Counter
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AcademicRecord, Student
from app.schemas import CODE_PATTERN, FORMULA_PREFIXES, YEAR_PATTERN

TEMPLATE_COLUMNS = [
    "student_code", "full_name", "year_group", "subject", "academic_year", "period1_grade",
    "period2_grade", "final_grade", "absences", "study_time", "past_failures", "school_support",
    "activities", "wants_higher_education",
]
TEMPLATE_EXAMPLE = [
    "S-1001", "Example Learner", "Year 11", "math", "2025/26", "12", "11", "", "3", "2", "0",
    "no", "yes", "yes",
]
MAX_ERRORS_REPORTED = 50
NAME_PATTERN = re.compile(r"^[^\x00-\x1f]{1,120}$")
INT_RANGES = {
    "period1_grade": (0, 20, True), "period2_grade": (0, 20, True), "final_grade": (0, 20, True),
    "absences": (0, 93, False), "study_time": (1, 4, False), "past_failures": (0, 3, False),
}
BOOL_COLUMNS = ("school_support", "activities", "wants_higher_education")


def template_csv() -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(TEMPLATE_COLUMNS)
    writer.writerow(TEMPLATE_EXAMPLE)
    return buffer.getvalue()


def _check_row(row: dict[str, str]) -> list[tuple[str, str]]:
    errors: list[tuple[str, str]] = []
    if not CODE_PATTERN.match(row["student_code"]):
        errors.append(("student_code", "Use letters, numbers, hyphens and underscores."))
    name = row["full_name"]
    if not NAME_PATTERN.match(name) or name.startswith(FORMULA_PREFIXES):
        errors.append(("full_name", "Required, up to 120 characters, must not start with = + - @."))
    if row["year_group"] and (len(row["year_group"]) > 40
                              or row["year_group"].startswith(FORMULA_PREFIXES)):
        errors.append(("year_group", "Up to 40 characters, must not start with = + - @."))
    if row["subject"] not in ("math", "portuguese"):
        errors.append(("subject", "Must be math or portuguese."))
    if not YEAR_PATTERN.match(row["academic_year"]):
        errors.append(("academic_year", "Must look like 2025 or 2025/26."))
    for column, (low, high, optional) in INT_RANGES.items():
        value = row[column]
        if value == "" and optional:
            continue
        if not re.fullmatch(r"\d{1,3}", value) or not low <= int(value) <= high:
            errors.append((column, f"Must be a whole number from {low} to {high}."))
    for column in BOOL_COLUMNS:
        if row[column].lower() not in ("yes", "no"):
            errors.append((column, "Must be yes or no."))
    return errors


def validate_csv(content: bytes, max_rows: int) -> dict[str, Any]:
    """Return a report. `valid` is False unless every row passes."""

    def failed(message: str) -> dict[str, Any]:
        return {"valid": False, "file_error": message, "row_count": 0, "column_count": 0,
                "error_count": 1, "errors": [], "rows": []}

    if b"\x00" in content:
        return failed("This does not look like a text CSV file.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return failed("The file must be UTF-8 encoded text.")
    if not text.strip():
        return failed("The file is empty.")

    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        columns = [c.strip() for c in (reader.fieldnames or [])]
        missing = [c for c in TEMPLATE_COLUMNS if c not in columns]
        if missing:
            result = failed(f"Missing required columns: {', '.join(missing)}.")
            result["column_count"] = len(columns)
            return result
        reader.fieldnames = columns

        rows: list[dict[str, str]] = []
        errors: list[dict[str, Any]] = []
        error_count = 0
        seen: Counter[tuple[str, str, str]] = Counter()
        missing_by_column: Counter[str] = Counter()
        for line, raw in enumerate(reader, start=2):
            if len(rows) >= max_rows:
                return failed(f"The file has more than the {max_rows} rows allowed.")
            if raw.get(None) or any(raw.get(c) is None for c in TEMPLATE_COLUMNS):
                problems = [("row", "Wrong number of columns.")]
                row = {}
            else:
                row = {c: (raw[c] or "").strip() for c in TEMPLATE_COLUMNS}
                problems = _check_row(row)
                key = (row["student_code"], row["subject"], row["academic_year"])
                seen[key] += 1
                if seen[key] > 1:
                    problems.append(("row", "Duplicate of an earlier student, subject and year."))
                for column in TEMPLATE_COLUMNS:
                    if row[column] == "":
                        missing_by_column[column] += 1
            for column, message in problems:
                error_count += 1
                if len(errors) < MAX_ERRORS_REPORTED:
                    errors.append({"line": line, "column": column, "message": message})
            rows.append(row)
    except csv.Error as exc:
        return failed(f"The file could not be read as CSV: {exc}")

    if not rows:
        return failed("The file has a header but no data rows.")

    good = [r for r in rows if r]
    finals = [int(r["final_grade"]) for r in good if re.fullmatch(r"\d{1,2}", r["final_grade"])]
    return {
        "valid": error_count == 0,
        "file_error": None,
        "row_count": len(rows),
        "column_count": len(columns),
        "error_count": error_count,
        "errors": errors,
        "profile": {
            "distinct_students": len({r["student_code"] for r in good}),
            "subjects": dict(Counter(r["subject"] for r in good)),
            "missing_by_column": dict(missing_by_column),
            "final_grades_present": len(finals),
            "average_final_grade": round(sum(finals) / len(finals), 2) if finals else None,
        },
        "rows": rows,
    }


def _to_int(value: str) -> int | None:
    return int(value) if value != "" else None


def import_rows(db: Session, rows: list[dict[str, str]], dataset_id: int) -> dict[str, Any]:
    """Upsert validated rows. One student code stays one student. Does not commit."""
    summary = {"students_created": 0, "students_updated": 0,
               "records_created": 0, "records_updated": 0}
    records: list[tuple[Student, AcademicRecord]] = []
    students: dict[str, Student] = {}
    for row in rows:
        code = row["student_code"]
        student = students.get(code) or db.scalar(
            select(Student).where(Student.student_code == code))
        if student is None:
            student = Student(student_code=code, full_name=row["full_name"],
                              year_group=row["year_group"] or None, source_dataset_id=dataset_id)
            db.add(student)
            db.flush()
            summary["students_created"] += 1
        elif code not in students:
            student.full_name = row["full_name"]
            student.year_group = row["year_group"] or student.year_group
            summary["students_updated"] += 1
        students[code] = student

        record = db.scalar(select(AcademicRecord).where(
            AcademicRecord.student_id == student.id,
            AcademicRecord.subject == row["subject"],
            AcademicRecord.academic_year == row["academic_year"],
        ))
        if record is None:
            record = AcademicRecord(student_id=student.id, subject=row["subject"],
                                    academic_year=row["academic_year"])
            db.add(record)
            summary["records_created"] += 1
        else:
            summary["records_updated"] += 1
        record.period1_grade = _to_int(row["period1_grade"])
        record.period2_grade = _to_int(row["period2_grade"])
        record.final_grade = _to_int(row["final_grade"])
        record.absences = int(row["absences"])
        record.study_time = int(row["study_time"])
        record.past_failures = int(row["past_failures"])
        record.school_support = row["school_support"].lower() == "yes"
        record.activities = row["activities"].lower() == "yes"
        record.wants_higher_education = row["wants_higher_education"].lower() == "yes"
        db.flush()
        records.append((student, record))
    summary["_records"] = records
    return summary
