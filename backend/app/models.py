"""Relational schema. Student identity lives once in `students`; everything else references it."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow

JsonType = JSON().with_variant(JSONB(), "postgresql")

ROLES = ("admin", "educator", "student")
SUBJECTS = ("math", "portuguese")
RISK_LEVELS = ("low", "moderate", "high")
STAGES = ("intake", "period1", "period2")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="role_valid"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Incremented on logout and on password change, which invalidates issued tokens.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    student_profile: Mapped[Student | None] = relationship(
        back_populates="user", foreign_keys="Student.user_id"
    )


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (
        CheckConstraint(_in("status", ("validated", "rejected", "processed")),
                        name="status_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_filename: Mapped[str | None] = mapped_column(String(80))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    column_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), index=True)
    validation_report: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    processing_summary: Mapped[dict[str, Any] | None] = mapped_column(JsonType)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    uploaded_by: Mapped[User | None] = relationship()


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), index=True)
    email: Mapped[str | None] = mapped_column(String(255))
    year_group: Mapped[str | None] = mapped_column(String(40), index=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), unique=True
    )
    source_dataset_id: Mapped[int | None] = mapped_column(
        ForeignKey("datasets.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped[User | None] = relationship(
        back_populates="student_profile", foreign_keys=[user_id]
    )
    records: Mapped[list[AcademicRecord]] = relationship(
        back_populates="student", cascade="all, delete-orphan", passive_deletes=True,
        order_by="AcademicRecord.academic_year, AcademicRecord.subject",
    )
    recommendations: Mapped[list[AcademicRecommendation]] = relationship(
        back_populates="student", cascade="all, delete-orphan", passive_deletes=True,
    )


class AcademicRecord(Base):
    """One student taking one subject in one academic year."""

    __tablename__ = "academic_records"
    __table_args__ = (
        UniqueConstraint("student_id", "subject", "academic_year", name="uq_record_per_course"),
        CheckConstraint(_in("subject", SUBJECTS), name="subject_valid"),
        CheckConstraint("period1_grade IS NULL OR period1_grade BETWEEN 0 AND 20", name="g1_range"),
        CheckConstraint("period2_grade IS NULL OR period2_grade BETWEEN 0 AND 20", name="g2_range"),
        CheckConstraint("final_grade IS NULL OR final_grade BETWEEN 0 AND 20", name="g3_range"),
        CheckConstraint("absences >= 0", name="absences_positive"),
        CheckConstraint("study_time BETWEEN 1 AND 4", name="study_time_range"),
        CheckConstraint("past_failures BETWEEN 0 AND 3", name="failures_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), index=True
    )
    subject: Mapped[str] = mapped_column(String(20), index=True)
    academic_year: Mapped[str] = mapped_column(String(20), index=True)
    period1_grade: Mapped[int | None] = mapped_column(Integer)
    period2_grade: Mapped[int | None] = mapped_column(Integer)
    final_grade: Mapped[int | None] = mapped_column(Integer)
    absences: Mapped[int] = mapped_column(Integer, default=0)
    study_time: Mapped[int] = mapped_column(Integer, default=2)
    past_failures: Mapped[int] = mapped_column(Integer, default=0)
    school_support: Mapped[bool] = mapped_column(Boolean, default=False)
    activities: Mapped[bool] = mapped_column(Boolean, default=False)
    wants_higher_education: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    student: Mapped[Student] = relationship(back_populates="records")


class ModelVersion(Base):
    __tablename__ = "model_versions"
    __table_args__ = (
        UniqueConstraint("version", "stage", name="uq_model_version_stage"),
        CheckConstraint(_in("stage", STAGES), name="stage_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(String(80), index=True)
    stage: Mapped[str] = mapped_column(String(20))
    classifier_algorithm: Mapped[str] = mapped_column(String(60))
    regressor_algorithm: Mapped[str] = mapped_column(String(60))
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    dataset_sha256: Mapped[str] = mapped_column(String(64))
    test_metrics: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (
        CheckConstraint(_in("stage", STAGES), name="stage_valid"),
        CheckConstraint(_in("subject", SUBJECTS), name="subject_valid"),
        CheckConstraint(_in("risk_level", RISK_LEVELS), name="risk_level_valid"),
        CheckConstraint("risk_probability BETWEEN 0 AND 1", name="probability_range"),
        Index("ix_predictions_student_subject", "student_id", "subject"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Empty for a hypothetical "what-if" scenario that is not about a specific student.
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    academic_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("academic_records.id", ondelete="SET NULL")
    )
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), index=True)
    requested_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    stage: Mapped[str] = mapped_column(String(20))
    subject: Mapped[str] = mapped_column(String(20))
    input_features: Mapped[dict[str, Any]] = mapped_column(JsonType)
    predicted_at_risk: Mapped[bool] = mapped_column(Boolean)
    risk_probability: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(20), index=True)
    confidence: Mapped[float] = mapped_column(Float)
    predicted_grade: Mapped[float] = mapped_column(Float)
    grade_interval_low: Mapped[float] = mapped_column(Float)
    grade_interval_high: Mapped[float] = mapped_column(Float)
    contributions: Mapped[list[dict[str, Any]]] = mapped_column(JsonType)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    student: Mapped[Student | None] = relationship()
    model_version: Mapped[ModelVersion] = relationship()
    requested_by: Mapped[User | None] = relationship()
    history: Mapped[list[PredictionHistory]] = relationship(
        back_populates="prediction", cascade="all, delete-orphan", passive_deletes=True,
        order_by="PredictionHistory.id",
    )


class PredictionHistory(Base):
    """Audit trail per prediction, including educators' human review."""

    __tablename__ = "prediction_history"
    __table_args__ = (
        CheckConstraint(_in("action", ("created", "reviewed")), name="action_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    prediction_id: Mapped[int] = mapped_column(
        ForeignKey("predictions.id", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    prediction: Mapped[Prediction] = relationship(back_populates="history")
    actor: Mapped[User | None] = relationship()


class AcademicRecommendation(Base):
    __tablename__ = "academic_recommendations"
    __table_args__ = (
        CheckConstraint(_in("priority", ("low", "medium", "high")), name="priority_valid"),
        CheckConstraint(_in("status", ("open", "completed")), name="status_valid"),
        CheckConstraint(_in("source", ("rule", "educator")), name="source_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), index=True
    )
    prediction_id: Mapped[int | None] = mapped_column(
        ForeignKey("predictions.id", ondelete="SET NULL")
    )
    category: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    status: Mapped[str] = mapped_column(String(12), default="open")
    source: Mapped[str] = mapped_column(String(12), default="rule")
    # Students see a recommendation only after an educator has chosen to share it.
    shared_with_student: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    student: Mapped[Student] = relationship(back_populates="recommendations")


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[Any] = mapped_column(JsonType)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class AuditLog(Base):
    """Who did what to student data. Holds identifiers and actions, never grades."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(40))
    detail: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    actor: Mapped[User | None] = relationship()
