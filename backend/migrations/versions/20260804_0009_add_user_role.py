"""add user role

Revision ID: 20260804_0009
Revises: 20260422_0008
Create Date: 2026-08-04 11:20:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260804_0009"
down_revision = "20260422_0008"
branch_labels = None
depends_on = None


user_role = sa.Enum("user", "admin", name="user_role")


def _column_type(bind):
    if bind.dialect.name == "postgresql":
        return postgresql.ENUM(
            "user",
            "admin",
            name="user_role",
            create_type=False,
        )
    return user_role


def upgrade():
    bind = op.get_bind()
    column_type = _column_type(bind)
    if bind.dialect.name == "postgresql":
        column_type.create(bind, checkfirst=True)

    op.add_column(
        "users",
        sa.Column("role", column_type, nullable=False, server_default="user"),
    )


def downgrade():
    bind = op.get_bind()
    column_type = _column_type(bind)
    op.drop_column("users", "role")
    if bind.dialect.name == "postgresql":
        column_type.drop(bind, checkfirst=True)
