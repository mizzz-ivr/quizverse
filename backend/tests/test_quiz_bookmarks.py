from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask_jwt_extended import create_access_token

from app import create_app
from app.config import Config
from app.extensions import db
from app.models import Question, Quiz, QuizStatus, User, UserRole, UserStatus
from app.models_bookmarks import QuizBookmark


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = "test"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-32-plus-bytes"
    JWT_COOKIE_SECURE = False
    ADMIN_BOOTSTRAP_EMAILS = []


def make_client():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def headers(app, user_id):
    with app.app_context():
        token = create_access_token(identity=str(user_id))
    return {"Authorization": f"Bearer {token}"}


def add_user(app, user_id, email, name, *, status=UserStatus.active):
    with app.app_context():
        db.session.add(
            User(
                id=user_id,
                email=email,
                display_name=name,
                role=UserRole.user,
                status=status,
            )
        )
        db.session.commit()


def add_quiz(app, quiz_id, author_id, title, *, status=QuizStatus.published):
    with app.app_context():
        db.session.add(
            Quiz(
                id=quiz_id,
                author_user_id=author_id,
                title=title,
                description=f"{title}の説明",
                category="技術",
                status=status,
            )
        )
        db.session.add(
            Question(
                id=quiz_id * 10,
                quiz_id=quiz_id,
                body="問題",
                sort_order=1,
                points=1,
            )
        )
        db.session.commit()


def test_bookmark_add_status_and_remove_are_idempotent():
    app, client = make_client()
    add_user(app, 1, "user@example.com", "User")
    add_quiz(app, 10, 1, "保存対象")
    auth = headers(app, 1)

    first = client.put("/api/me/bookmarks/10", headers=auth)
    duplicate = client.put("/api/me/bookmarks/10", headers=auth)
    status = client.get("/api/me/bookmarks/10", headers=auth)
    removed = client.delete("/api/me/bookmarks/10", headers=auth)
    duplicate_remove = client.delete("/api/me/bookmarks/10", headers=auth)

    assert first.status_code == 201
    assert first.get_json()["meta"]["changed"] is True
    assert duplicate.status_code == 200
    assert duplicate.get_json()["meta"]["changed"] is False
    assert status.get_json()["bookmarked"] is True
    assert removed.get_json() == {
        "quiz_id": "10",
        "bookmarked": False,
        "meta": {"changed": True},
    }
    assert duplicate_remove.get_json()["meta"]["changed"] is False


def test_bookmark_list_is_owner_scoped_sorted_paginated_and_hides_unpublished():
    app, client = make_client()
    add_user(app, 1, "user@example.com", "User")
    add_user(app, 2, "other@example.com", "Other")
    add_quiz(app, 10, 1, "古い公開クイズ")
    add_quiz(app, 11, 1, "新しい公開クイズ")
    add_quiz(app, 12, 1, "非公開クイズ", status=QuizStatus.archived)
    now = datetime.now(timezone.utc)

    with app.app_context():
        db.session.add_all(
            [
                QuizBookmark(user_id=1, quiz_id=10, created_at=now - timedelta(days=1)),
                QuizBookmark(user_id=1, quiz_id=11, created_at=now),
                QuizBookmark(user_id=1, quiz_id=12, created_at=now + timedelta(minutes=1)),
                QuizBookmark(user_id=2, quiz_id=10, created_at=now + timedelta(minutes=2)),
            ]
        )
        db.session.commit()

    response = client.get(
        "/api/me/bookmarks",
        headers=headers(app, 1),
        query_string={"page": 1, "per_page": 1},
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["pagination"] == {
        "page": 1,
        "per_page": 1,
        "total": 2,
        "total_pages": 2,
    }
    assert len(payload["items"]) == 1
    assert payload["items"][0]["quiz"]["id"] == "11"
    assert payload["items"][0]["quiz"]["question_count"] == 1
    assert payload["items"][0]["quiz"]["author"]["display_name"] == "User"


def test_unpublished_quiz_cannot_be_added_or_status_probed_but_can_be_removed():
    app, client = make_client()
    add_user(app, 1, "user@example.com", "User")
    add_quiz(app, 10, 1, "非公開", status=QuizStatus.archived)
    auth = headers(app, 1)

    with app.app_context():
        db.session.add(QuizBookmark(user_id=1, quiz_id=10))
        db.session.commit()

    add_response = client.put("/api/me/bookmarks/10", headers=auth)
    status_response = client.get("/api/me/bookmarks/10", headers=auth)
    remove_response = client.delete("/api/me/bookmarks/10", headers=auth)

    assert add_response.status_code == 404
    assert status_response.status_code == 404
    assert remove_response.status_code == 200
    assert remove_response.get_json()["meta"]["changed"] is True


def test_bookmark_endpoints_require_active_authenticated_user():
    app, client = make_client()
    add_user(app, 1, "suspended@example.com", "Suspended", status=UserStatus.suspended)

    anonymous = client.get("/api/me/bookmarks")
    suspended = client.get("/api/me/bookmarks", headers=headers(app, 1))

    assert anonymous.status_code == 401
    assert suspended.status_code == 403
    assert suspended.get_json()["error"]["code"] == "auth/account_inactive"


def test_bookmark_query_validation_and_schema_contract():
    app, client = make_client()
    add_user(app, 1, "user@example.com", "User")
    auth = headers(app, 1)

    assert client.get(
        "/api/me/bookmarks",
        headers=auth,
        query_string={"page": 0},
    ).status_code == 400
    assert client.get(
        "/api/me/bookmarks",
        headers=auth,
        query_string={"per_page": 51},
    ).status_code == 400

    assert list(QuizBookmark.__table__.primary_key.columns.keys()) == ["user_id", "quiz_id"]
    assert "ix_quiz_bookmarks_quiz_id" in {index.name for index in QuizBookmark.__table__.indexes}

    migration = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "20260812_0010_add_quiz_bookmarks.py"
    ).read_text(encoding="utf-8")
    assert 'revision = "20260812_0010"' in migration
    assert 'down_revision = "20260804_0009"' in migration
    assert 'op.create_table(\n        "quiz_bookmarks"' in migration
    assert 'sa.PrimaryKeyConstraint("user_id", "quiz_id")' in migration
