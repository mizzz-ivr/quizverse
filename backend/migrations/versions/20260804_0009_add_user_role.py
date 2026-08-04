"""add user role

Revision ID: 20260804_0009
Revises: 20260422_0008
Create Date: 2026-08-04 11:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260804_0009"
down_revision = "20260422_0008"
branch_labels = None
depends_on = None


user_role = sa.Enum("user", "admin", name="user_role")


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        user_role.create(bind, checkfirst=True)

    op.add_column(
        "users",
        sa.Column("role", user_role, nullable=False, server_default="user"),
    )
    op.alter_column("users", "role", server_default=None)


def downgrade():
    op.drop_column("users", "role")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        user_role.drop(bind, checkfirst=True)
