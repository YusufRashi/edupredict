"""Request and response contracts for the API."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Role = Literal["admin", "educator", "student"]
Subject = Literal["math", "portuguese"]
RiskLevel = Literal["low", "moderate", "high"]
StageKey = Literal["intake", "period1", "period2"]
Priority = Literal["low", "medium", "high"]

CODE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$")
YEAR_PATTERN = re.compile(r"^\d{4}(/\d{2,4})?$")
# Blocks spreadsheet formula injection at the point of entry.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def check_password(value: str) -> str:
    if len(value) < 10:
        raise ValueError("Password must be at least 10 characters.")
    if len(value.encode()) > 72:
        raise ValueError("Password must be at most 72 bytes.")
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("Password must contain a letter and a number.")
    return value


def check_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Name is required.")
    if value.startswith(FORMULA_PREFIXES):
        raise ValueError("Name cannot start with =, +, - or @.")
    return value


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


# ---- Auth and users ----
class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    password: str

    _name = field_validator("full_name")(check_name)
    _password = field_validator("password")(check_password)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=512)


class UserOut(ORMModel):
    id: int
    email: str
    full_name: str
    role: Role
    is_active: bool
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    current_password: str | None = Field(default=None, max_length=512)

    _name = field_validator("full_name")(lambda v: check_name(v) if v is not None else v)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=512)
    new_password: str

    _password = field_validator("new_password")(check_password)


class UserCreate(RegisterRequest):
    role: Role


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: Role | None = None
    is_active: bool | None = None

    _name = field_validator("full_name")(lambda v: check_name(v) if v is not None else v)


# ---- Students and records ----
class RecordBase(BaseModel):
    subject: Subject
    academic_year: str = Field(max_length=20)
    period1_grade: int | None = Field(default=None, ge=0, le=20)
    period2_grade: int | None = Field(default=None, ge=0, le=20)
    final_grade: int | None = Field(default=None, ge=0, le=20)
    absences: int = Field(default=0, ge=0, le=93)
    study_time: int = Field(default=2, ge=1, le=4)
    past_failures: int = Field(default=0, ge=0, le=3)
    school_support: bool = False
    activities: bool = False
    wants_higher_education: bool = True

    @field_validator("academic_year")
    @classmethod
    def valid_year(cls, value: str) -> str:
        if not YEAR_PATTERN.match(value):
            raise ValueError("Academic year must look like 2025 or 2025/26.")
        return value


class RecordCreate(RecordBase):
    pass


class RecordOut(RecordBase, ORMModel):
    id: int
    student_id: int


class StudentBase(BaseModel):
    student_code: str = Field(max_length=40)
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr | None = None
    year_group: str | None = Field(default=None, max_length=40)

    _name = field_validator("full_name")(check_name)

    @field_validator("student_code")
    @classmethod
    def valid_code(cls, value: str) -> str:
        if not CODE_PATTERN.match(value):
            raise ValueError("Student code may use letters, numbers, hyphens and underscores.")
        return value

    @field_validator("year_group")
    @classmethod
    def valid_year_group(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return check_name(value)


class StudentCreate(StudentBase):
    linked_user_email: EmailStr | None = None


class StudentUpdate(StudentCreate):
    pass


class StudentListItem(BaseModel):
    id: int
    student_code: str
    full_name: str
    year_group: str | None
    is_demo: bool
    subjects: list[str]
    average_final_grade: float | None
    highest_risk: RiskLevel | None


class RecommendationCreate(BaseModel):
    category: str = Field(default="general", min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=2000)
    priority: Priority = "medium"
    shared_with_student: bool = False


class RecommendationUpdate(BaseModel):
    status: Literal["open", "completed"] | None = None
    shared_with_student: bool | None = None


class RecommendationOut(ORMModel):
    id: int
    student_id: int
    prediction_id: int | None
    category: str
    title: str
    message: str
    priority: Priority
    status: str
    source: str
    shared_with_student: bool
    created_at: datetime


# ---- Predictions ----
class PredictionCreate(BaseModel):
    stage: StageKey
    features: dict[str, Any]
    student_id: int | None = None
    academic_record_id: int | None = None


class PredictionSummary(ORMModel):
    id: int
    student_id: int | None
    student_name: str | None = None
    student_code: str | None = None
    academic_record_id: int | None
    stage: StageKey
    subject: Subject
    predicted_at_risk: bool
    risk_probability: float
    risk_level: RiskLevel
    confidence: float
    predicted_grade: float
    grade_interval_low: float
    grade_interval_high: float
    is_demo: bool
    model_version: str
    actual_final_grade: int | None = None
    created_at: datetime


class HistoryOut(BaseModel):
    action: str
    actor_name: str | None
    note: str | None
    created_at: datetime


class PredictionDetail(PredictionSummary):
    input_features: dict[str, Any]
    contributions: list[dict[str, Any]]
    classifier_algorithm: str
    regressor_algorithm: str
    requested_by_name: str | None = None
    history: list[HistoryOut] = []
    recommendations: list[RecommendationOut] = []
    disclaimer: str
    # True when the grade estimate and the below-pass flag point in different directions.
    estimates_disagree: bool
    pass_mark: int


class ReviewRequest(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


class StudentDetail(BaseModel):
    id: int
    student_code: str
    full_name: str
    email: str | None
    year_group: str | None
    is_demo: bool
    linked_user_email: str | None = None
    records: list[RecordOut]
    latest_predictions: list[PredictionSummary] = []
    recommendations: list[RecommendationOut] = []


# ---- Settings and datasets ----
class SettingsOut(BaseModel):
    allow_public_registration: bool
    educators_can_upload_datasets: bool


class SettingsUpdate(BaseModel):
    allow_public_registration: bool | None = None
    educators_can_upload_datasets: bool | None = None


class DatasetOut(ORMModel):
    id: int
    name: str
    original_filename: str
    size_bytes: int
    row_count: int
    column_count: int
    status: str
    validation_report: dict[str, Any]
    processing_summary: dict[str, Any] | None
    created_at: datetime
    processed_at: datetime | None
    uploaded_by_name: str | None = None
