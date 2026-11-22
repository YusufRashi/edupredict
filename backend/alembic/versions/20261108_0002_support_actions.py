"""support actions

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "support_actions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("subject", sa.String(length=20), nullable=False),
        sa.Column("prediction_id", sa.Integer(), nullable=True),
        sa.Column("action_type", sa.String(length=30), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("outcome_note", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("subject IN ('math', 'portuguese')",
                           name=op.f("ck_support_actions_subject_valid")),
        sa.CheckConstraint(
            "action_type IN ('tutoring', 'meeting', 'family_contact', 'attendance_plan', "
            "'referral', 'other')",
            name=op.f("ck_support_actions_action_type_valid")),
        sa.CheckConstraint("status IN ('planned', 'done', 'cancelled')",
                           name=op.f("ck_support_actions_status_valid")),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"],
                                name=op.f("fk_support_actions_student_id_students"),
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prediction_id"], ["predictions.id"],
                                name=op.f("fk_support_actions_prediction_id_predictions"),
                                ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"],
                                name=op.f("fk_support_actions_owner_id_users"),
                                ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"],
                                name=op.f("fk_support_actions_created_by_id_users"),
                                ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_support_actions")),
    )
    op.create_index(op.f("ix_support_actions_student_id"), "support_actions", ["student_id"])
    op.create_index(op.f("ix_support_actions_status"), "support_actions", ["status"])
    op.create_index(op.f("ix_support_actions_due_date"), "support_actions", ["due_date"])
    op.create_index(op.f("ix_support_actions_owner_id"), "support_actions", ["owner_id"])


def downgrade() -> None:
    op.drop_table("support_actions")
