from datetime import datetime, timedelta, timezone

from flask_jwt_extended import create_access_token

from app import create_app
from app.extensions import db
from app.models import (
    AnswerResult,
    Choice,
    PlayStatus,
    Question,
    Quiz,
    QuizPlay,
    QuizPlayAnswer,
    QuizStatus,
    User,
    UserRole,
    UserStatus,
)


class TestConfig:
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = "test"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-32-plus-bytes"
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)
    JWT_TOKEN_LOCATION = ["headers", "cookies"]
    JWT_COOKIE_SECURE = False
    JWT_COOKIE_SAMESITE = "Lax"
    JWT_COOKIE_DOMAIN = None
    JWT_SESSION_COOKIE = False
    JWT_COOKIE_CSRF_PROTECT = True
    JWT_CSRF_IN_COOKIES = True
    JWT_ACCESS_COOKIE_NAME = "quizverse_access_token"
    JWT_REFRESH_COOKIE_NAME = "quizverse_refresh_token"
    JWT_ACCESS_CSRF_COOKIE_NAME = "quizverse_csrf_access"
    JWT_REFRESH_CSRF_COOKIE_NAME = "quizverse_csrf_refresh"
    JWT_ACCESS_CSRF_HEADER_NAME = "X-CSRF-TOKEN"
    JWT_REFRESH_CSRF_HEADER_NAME = "X-CSRF-TOKEN"
    JWT_ACCESS_COOKIE_PATH = "/"
    JWT_REFRESH_COOKIE_PATH = "/api/auth/refresh"
    JWT_ACCESS_CSRF_COOKIE_PATH = "/"
    JWT_REFRESH_CSRF_COOKIE_PATH = "/"
    AUTH_TRUSTED_ORIGINS = []
    AUTH_EXPOSE_TOKEN_IN_RESPONSE = False
    AUTH_ENABLE_DEV_TOKEN_ENDPOINT = True
    ADMIN_BOOTSTRAP_EMAILS = []
    GOOGLE_OAUTH_CLIENT_ID = "google-client-id.apps.googleusercontent.com"
    OTP_EXPIRES_SECONDS = 300
    OTP_MIN_RESEND_SECONDS = 60
    OTP_MAX_REQUESTS_PER_HOUR = 5
    OTP_MAX_VERIFY_ATTEMPTS = 5
    OTP_INCLUDE_CODE_IN_RESPONSE = True
    QUIZ_PUBLICATION_ENFORCED = True


def _create_client():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _headers(app, user_id):
    with app.app_context():
        token = create_access_token(identity=str(user_id))
    return {"Authorization": f"Bearer {token}"}


def _seed_user(app, user_id, email, display_name, *, status=UserStatus.active):
    with app.app_context():
        db.session.add(
            User(
                id=user_id,
                email=email,
                display_name=display_name,
                role=UserRole.user,
                status=status,
            )
        )
        db.session.commit()


def _seed_quiz(app, quiz_id, author_id, title, *, status=QuizStatus.published):
    with app.app_context():
        db.session.add(
            Quiz(
                id=quiz_id,
                author_user_id=author_id,
                title=title,
                category="技術",
                status=status,
            )
        )
        db.session.commit()


def _seed_play(
    app,
    play_id,
    quiz_id,
    user_id,
    *,
    correct,
    total,
    score,
    submitted_at,
    status=PlayStatus.submitted,
):
    with app.app_context():
        db.session.add(
            QuizPlay(
                id=play_id,
                quiz_id=quiz_id,
                player_user_id=user_id,
                status=status,
                started_at=submitted_at - timedelta(minutes=2),
                submitted_at=submitted_at if status == PlayStatus.submitted else None,
                score=score,
                correct_answers=correct,
                total_questions=total,
            )
        )
        db.session.commit()


def test_profile_returns_weighted_stats_and_created_quiz_count():
    app, client = _create_client()
    _seed_user(app, 1, "user@example.com", "User")
    _seed_quiz(app, 10, 1, "作成したクイズ")
    _seed_quiz(app, 11, 1, "2つ目")
    now = datetime.now(timezone.utc)
    _seed_play(app, 100, 10, 1, correct=2, total=2, score=2, submitted_at=now)
    _seed_play(app, 101, 11, 1, correct=1, total=3, score=1, submitted_at=now - timedelta(days=1))
    _seed_play(
        app,
        102,
        11,
        1,
        correct=0,
        total=0,
        score=0,
        submitted_at=now,
        status=PlayStatus.started,
    )

    response = client.get("/api/me/profile", headers=_headers(app, 1))

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["user"]["email"] == "user@example.com"
    assert payload["stats"] == {
        "play_count": 2,
        "attempted_quiz_count": 2,
        "correct_answers": 3,
        "total_questions": 5,
        "average_accuracy_percentage": 60.0,
        "perfect_play_count": 1,
        "created_quiz_count": 2,
    }


def test_profile_display_name_update_trims_and_handles_same_value():
    app, client = _create_client()
    _seed_user(app, 1, "user@example.com", "Before")
    headers = _headers(app, 1)

    updated = client.patch(
        "/api/me/profile",
        headers=headers,
        json={"display_name": "  After  "},
    )
    unchanged = client.patch(
        "/api/me/profile",
        headers=headers,
        json={"display_name": "After"},
    )
    invalid = client.patch(
        "/api/me/profile",
        headers=headers,
        json={"display_name": " "},
    )

    assert updated.status_code == 200
    assert updated.get_json()["user"]["display_name"] == "After"
    assert updated.get_json()["meta"]["changed"] is True
    assert unchanged.get_json()["meta"]["changed"] is False
    assert invalid.status_code == 400


def test_play_history_is_scoped_sorted_paginated_and_filtered():
    app, client = _create_client()
    _seed_user(app, 1, "user@example.com", "User")
    _seed_user(app, 2, "other@example.com", "Other")
    _seed_quiz(app, 10, 1, "公開クイズ")
    _seed_quiz(app, 11, 1, "非公開クイズ", status=QuizStatus.archived)
    now = datetime.now(timezone.utc)
    _seed_play(app, 100, 10, 1, correct=3, total=3, score=3, submitted_at=now)
    _seed_play(app, 101, 11, 1, correct=2, total=3, score=2, submitted_at=now - timedelta(hours=1))
    _seed_play(app, 102, 10, 1, correct=1, total=3, score=1, submitted_at=now - timedelta(hours=2))
    _seed_play(app, 103, 10, 2, correct=3, total=3, score=3, submitted_at=now + timedelta(hours=1))

    first_page = client.get(
        "/api/me/plays",
        headers=_headers(app, 1),
        query_string={"page": 1, "per_page": 2},
    )
    passed = client.get(
        "/api/me/plays",
        headers=_headers(app, 1),
        query_string={"result": "passed"},
    )
    review = client.get(
        "/api/me/plays",
        headers=_headers(app, 1),
        query_string={"result": "review", "quiz_id": 10},
    )

    assert [item["id"] for item in first_page.get_json()["items"]] == ["100", "101"]
    assert first_page.get_json()["pagination"]["total"] == 3
    assert passed.get_json()["items"][0]["id"] == "101"
    assert passed.get_json()["items"][0]["quiz"]["is_replayable"] is False
    assert [item["id"] for item in review.get_json()["items"]] == ["102"]


def test_play_detail_returns_question_choices_and_explanation_for_owner_only():
    app, client = _create_client()
    _seed_user(app, 1, "user@example.com", "User")
    _seed_user(app, 2, "other@example.com", "Other")
    _seed_quiz(app, 10, 1, "詳細クイズ")
    now = datetime.now(timezone.utc)
    _seed_play(app, 100, 10, 1, correct=1, total=1, score=2, submitted_at=now)

    with app.app_context():
        db.session.add(
            Question(
                id=200,
                quiz_id=10,
                body="2 + 2 は？",
                explanation="4になります。",
                sort_order=1,
                points=2,
            )
        )
        db.session.add_all(
            [
                Choice(id=300, question_id=200, body="3", is_correct=False, sort_order=1),
                Choice(id=301, question_id=200, body="4", is_correct=True, sort_order=2),
            ]
        )
        db.session.add(
            QuizPlayAnswer(
                id=400,
                quiz_play_id=100,
                question_id=200,
                selected_choice_id=301,
                result=AnswerResult.correct,
                points_awarded=2,
            )
        )
        db.session.commit()

    own = client.get("/api/me/plays/100", headers=_headers(app, 1))
    other = client.get("/api/me/plays/100", headers=_headers(app, 2))

    assert own.status_code == 200
    question = own.get_json()["questions"][0]
    assert question["explanation"] == "4になります。"
    assert question["correct_choice_id"] == "301"
    assert question["selected_choice_id"] == "301"
    assert question["choices"][1]["is_correct"] is True
    assert other.status_code == 404


def test_profile_endpoints_require_active_authenticated_user():
    app, client = _create_client()
    _seed_user(app, 1, "suspended@example.com", "Suspended", status=UserStatus.suspended)

    anonymous = client.get("/api/me/profile")
    suspended = client.get("/api/me/profile", headers=_headers(app, 1))

    assert anonymous.status_code == 401
    assert suspended.status_code == 403
    assert suspended.get_json()["error"]["code"] == "auth/account_inactive"


def test_history_rejects_invalid_filters():
    app, client = _create_client()
    _seed_user(app, 1, "user@example.com", "User")
    headers = _headers(app, 1)

    invalid_result = client.get(
        "/api/me/plays",
        headers=headers,
        query_string={"result": "unknown"},
    )
    invalid_page = client.get(
        "/api/me/plays",
        headers=headers,
        query_string={"page": 0},
    )

    assert invalid_result.status_code == 400
    assert invalid_page.status_code == 400
