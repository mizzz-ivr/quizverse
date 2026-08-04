from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "backend" / "app" / "api" / "admin_user_management.py"


def test_actor_is_revalidated_after_shared_lock_before_target_mutation():
    source = SOURCE.read_text(encoding="utf-8")

    assert source.count("_revalidate_actor_after_lock()") == 3
    assert "db.session.refresh(actor, with_for_update=True)" in source

    role_handler = source.split("def patch_admin_user_role", 1)[1].split(
        "def patch_admin_user_status", 1
    )[0]
    status_handler = source.split("def patch_admin_user_status", 1)[1]

    for handler in (role_handler, status_handler):
        assert handler.index("_serialize_admin_mutation()") < handler.index(
            "_revalidate_actor_after_lock()"
        )
        assert handler.index("_revalidate_actor_after_lock()") < handler.index(
            "_load_target(user_id, lock=True)"
        )