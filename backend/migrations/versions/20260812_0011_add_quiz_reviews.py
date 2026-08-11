"""add quiz reviews

Revision ID: 20260812_0011
Revises: 20260812_0010
Create Date: 2026-08-12 08:45:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260812_0011"
down_revision = "20260812_0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "quiz_reviews",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("quiz_id", sa.BigInteger(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "rating >= 1 AND rating <= 5",
            name="ck_quiz_reviews_rating_range",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quiz_id"], ["quizzes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "quiz_id"),
    )
    op.create_index(
        "ix_quiz_reviews_quiz_id",
        "quiz_reviews",
        ["quiz_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_quiz_reviews_quiz_id", table_name="quiz_reviews")
    op.drop_table("quiz_reviews")
