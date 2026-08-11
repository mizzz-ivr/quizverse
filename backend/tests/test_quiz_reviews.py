from datetime import datetime, timezone
from pathlib import Path

from flask_jwt_extended import create_access_token

from app import create_app
from app.config import Config
from app.extensions import db
from app.models import PlayStatus, Quiz, QuizPlay, QuizStatus, User, UserRole, UserStatus
from app.models_reviews import QuizReview


class TestConfig(Config):
    TESTING = True
    QUIZ_PUBLICATION_ENFORCED = True
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


def auth_headers(app, user_id):
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
                published_at=datetime.now(timezone.utc) if status == QuizStatus.published else None,
            )
        )
        db.session.commit()


def add_submitted_play(app, play_id, quiz_id, user_id):
    with app.app_context():
        db.session.add(
            QuizPlay(
                id=play_id,
                quiz_id=quiz_id,
                player_user_id=user_id,
                status=PlayStatus.submitted,
                score=1,
                correct_answers=1,
                total_questions=1,
            )
        )
        db.session.commit()


def test_review_create_update_list_summary_and_delete():
    app, client = make_client()
    add_user(app, 1, "author@example.com", "Author")
    add_user(app, 2, "player@example.com", "Player")
    add_quiz(app, 10, 1, "レビュー対象")
    add_submitted_play(app, 100, 10, 2)
    auth = auth_headers(app, 2)

    created = client.put(
        "/api/quizzes/10/reviews/me",
        headers=auth,
        json={"rating": 5, "body": "  とても面白い  "},
    )
    assert created.status_code == 201
    created_payload = created.get_json()
    assert created_payload["review"]["rating"] == 5
    assert created_payload["review"]["body"] == "とても面白い"
    assert created_payload["summary"] == {"rating_average": 5.0, "review_count": 1}
    assert created_payload["meta"]["created"] is True

    mine = client.get("/api/quizzes/10/reviews/me", headers=auth)
    assert mine.status_code == 200
    assert mine.get_json()["eligibility"] == {"eligible": True, "reason": None}
    assert mine.get_json()["review"]["user"]["id"] == "2"

    updated = client.put(
        "/api/quizzes/10/reviews/me",
        headers=auth,
        json={"rating": 4, "body": "更新した感想"},
    )
    assert updated.status_code == 200
    assert updated.get_json()["meta"]["created"] is False
    assert updated.get_json()["summary"] == {"rating_average": 4.0, "review_count": 1}

    listed = client.get("/api/quizzes/10/reviews")
    assert listed.status_code == 200
    listed_payload = listed.get_json()
    assert listed_payload["summary"] == {"rating_average": 4.0, "review_count": 1}
    assert listed_payload["items"][0]["body"] == "更新した感想"
    assert listed_payload["items"][0]["user"]["display_name"] == "Player"

    removed = client.delete("/api/quizzes/10/reviews/me", headers=auth)
    duplicate_remove = client.delete("/api/quizzes/10/reviews/me", headers=auth)
    assert removed.status_code == 200
    assert removed.get_json()["meta"]["changed"] is True
    assert duplicate_remove.get_json()["meta"]["changed"] is False


def test_review_requires_active_player_and_rejects_author_or_unpublished_quiz():
    app, client = make_client()
    add_user(app, 1, "author@example.com", "Author")
    add_user(app, 2, "player@example.com", "Player")
    add_user(app, 3, "suspended@example.com", "Suspended", status=UserStatus.suspended)
    add_quiz(app, 10, 1, "公開クイズ")
    add_quiz(app, 11, 1, "非公開クイズ", status=QuizStatus.archived)
    add_submitted_play(app, 100, 10, 1)
    add_submitted_play(app, 101, 11, 2)

    assert client.get("/api/quizzes/10/reviews/me").status_code == 401

    unplayed = client.put(
        "/api/quizzes/10/reviews/me",
        headers=auth_headers(app, 2),
        json={"rating": 5},
    )
    assert unplayed.status_code == 403
    assert unplayed.get_json()["error"]["code"] == "review/play_required"

    author = client.put(
        "/api/quizzes/10/reviews/me",
        headers=auth_headers(app, 1),
        json={"rating": 5},
    )
    assert author.status_code == 403
    assert author.get_json()["error"]["code"] == "review/author_not_allowed"

    unpublished = client.put(
        "/api/quizzes/11/reviews/me",
        headers=auth_headers(app, 2),
        json={"rating": 5},
    )
    assert unpublished.status_code == 404
    assert client.get("/api/quizzes/11/reviews").status_code == 404

    suspended = client.get(
        "/api/quizzes/10/reviews/me",
        headers=auth_headers(app, 3),
    )
    assert suspended.status_code == 403
    assert suspended.get_json()["error"]["code"] == "auth/account_inactive"


def test_review_validation_owner_scope_and_pagination():
    app, client = make_client()
    add_user(app, 1, "author@example.com", "Author")
    add_user(app, 2, "one@example.com", "One")
    add_user(app, 3, "two@example.com", "Two")
    add_quiz(app, 10, 1, "対象")
    add_submitted_play(app, 100, 10, 2)
    add_submitted_play(app, 101, 10, 3)

    for invalid_rating in (0, 6, True, "5"):
        response = client.put(
            "/api/quizzes/10/reviews/me",
            headers=auth_headers(app, 2),
            json={"rating": invalid_rating},
        )
        assert response.status_code == 400

    too_long = client.put(
        "/api/quizzes/10/reviews/me",
        headers=auth_headers(app, 2),
        json={"rating": 5, "body": "x" * 1001},
    )
    assert too_long.status_code == 400

    assert client.put(
        "/api/quizzes/10/reviews/me",
        headers=auth_headers(app, 2),
        json={"rating": 5, "body": "One review"},
    ).status_code == 201
    assert client.put(
        "/api/quizzes/10/reviews/me",
        headers=auth_headers(app, 3),
        json={"rating": 3, "body": "Two review"},
    ).status_code == 201

    first_page = client.get(
        "/api/quizzes/10/reviews",
        query_string={"page": 1, "per_page": 1},
    ).get_json()
    assert first_page["pagination"] == {
        "page": 1,
        "per_page": 1,
        "total": 2,
        "total_pages": 2,
    }
    assert first_page["summary"] == {"rating_average": 4.0, "review_count": 2}

    client.delete("/api/quizzes/10/reviews/me", headers=auth_headers(app, 2))
    other_review = client.get("/api/quizzes/10/reviews/me", headers=auth_headers(app, 3)).get_json()
    assert other_review["review"]["body"] == "Two review"

    assert client.get("/api/quizzes/10/reviews", query_string={"page": 0}).status_code == 400
    assert client.get("/api/quizzes/10/reviews", query_string={"per_page": 51}).status_code == 400


def test_catalog_contains_rating_stats_and_supports_rating_sort():
    app, client = make_client()
    add_user(app, 1, "author@example.com", "Author")
    add_user(app, 2, "one@example.com", "One")
    add_user(app, 3, "two@example.com", "Two")
    add_quiz(app, 10, 1, "5点・2件")
    add_quiz(app, 11, 1, "5点・1件")
    add_quiz(app, 12, 1, "4点・1件")

    with app.app_context():
        db.session.add_all(
            [
                QuizReview(user_id=2, quiz_id=10, rating=5, body="A"),
                QuizReview(user_id=3, quiz_id=10, rating=5, body="B"),
                QuizReview(user_id=2, quiz_id=11, rating=5, body="C"),
                QuizReview(user_id=3, quiz_id=12, rating=4, body="D"),
            ]
        )
        db.session.commit()

    rated = client.get("/api/quizzes", query_string={"sort": "rating", "per_page": 10})
    assert rated.status_code == 200
    rated_payload = rated.get_json()
    assert [item["id"] for item in rated_payload["items"]] == ["10", "11", "12"]
    assert rated_payload["items"][0]["rating_average"] == 5.0
    assert rated_payload["items"][0]["review_count"] == 2
    assert rated_payload["filters"]["sort"] == "rating"

    latest = client.get("/api/quizzes", query_string={"sort": "latest", "per_page": 10})
    assert latest.status_code == 200
    assert latest.get_json()["filters"]["sort"] == "latest"
    assert all("rating_average" in item and "review_count" in item for item in latest.get_json()["items"])

    detail = client.get("/api/quizzes/10")
    assert detail.status_code == 200
    assert detail.get_json()["quiz"]["rating_average"] == 5.0
    assert detail.get_json()["quiz"]["review_count"] == 2

    invalid_sort = client.get("/api/quizzes", query_string={"sort": "unknown"})
    assert invalid_sort.status_code == 400
    assert invalid_sort.get_json()["error"]["code"] == "quiz/validation_error"


def test_review_schema_and_migration_contract():
    assert list(QuizReview.__table__.primary_key.columns.keys()) == ["user_id", "quiz_id"]
    assert "ix_quiz_reviews_quiz_id" in {index.name for index in QuizReview.__table__.indexes}
    assert "ck_quiz_reviews_rating_range" in {
        constraint.name for constraint in QuizReview.__table__.constraints if constraint.name
    }

    migration = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "20260812_0011_add_quiz_reviews.py"
    ).read_text(encoding="utf-8")
    assert 'revision = "20260812_0011"' in migration
    assert 'down_revision = "20260812_0010"' in migration
    assert 'op.create_table(\n        "quiz_reviews"' in migration
    assert 'sa.PrimaryKeyConstraint("user_id", "quiz_id")' in migration
    assert 'name="ck_quiz_reviews_rating_range"' in migration
