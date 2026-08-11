"""add quiz bookmarks

Revision ID: 20260812_0010
Revises: 20260804_0009
Create Date: 2026-08-12 08:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260812_0010"
down_revision = "20260804_0009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "quiz_bookmarks",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("quiz_id", sa.BigInteger(), nullable=False),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quiz_id"], ["quizzes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "quiz_id"),
    )
    op.create_index(
        "ix_quiz_bookmarks_quiz_id",
        "quiz_bookmarks",
        ["quiz_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_quiz_bookmarks_quiz_id", table_name="quiz_bookmarks")
    op.drop_table("quiz_bookmarks")
