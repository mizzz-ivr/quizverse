from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "backend" / "migrations" / "versions" / "20260804_0009_add_user_role.py"


def test_admin_bootstrap_environment_is_documented_and_forwarded():
    env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert "ADMIN_BOOTSTRAP_EMAILS=" in env_example
    assert "ADMIN_BOOTSTRAP_EMAILS: ${ADMIN_BOOTSTRAP_EMAILS:-}" in compose


def test_user_role_migration_follows_current_head():
    migration = MIGRATION.read_text(encoding="utf-8")

    assert 'revision = "20260804_0009"' in migration
    assert 'down_revision = "20260422_0008"' in migration
    assert 'sa.Enum("user", "admin", name="user_role")' in migration
    assert 'op.add_column(' in migration
    assert '"users"' in migration
    assert '"role"' in migration
    assert 'server_default="user"' in migration
    assert 'server_default=None' not in migration
