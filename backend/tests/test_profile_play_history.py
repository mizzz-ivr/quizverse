from datetime import datetime, timedelta, timezone

from flask_jwt_extended import create_access_token

from app import create_app
from app.config import Config
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


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = "test"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-32-plus-bytes"
    JWT_COOKIE_SECURE = False
    AUTH_ENABLE_DEV_TOKEN_ENDPOINT = True
    ADMIN_BOOTSTRAP_EMAILS = []
    OTP_INCLUDE_CODE_IN_RESPONSE = True


def make_client():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def headers(app, user_id):
    with app.app_context():
        token = create_access_token(identity=str(user_id))
    return {"Authorization": f"Bearer {token}"}


def add_user(app, user_id, email, name, status=UserStatus.active):
    with app.app_context():
        db.session.add(User(
            id=user_id,
            email=email,
            display_name=name,
            role=UserRole.user,
            status=status,
        ))
        db.session.commit()


def add_quiz(app, quiz_id, author_id, title, status=QuizStatus.published):
    with app.app_context():
        db.session.add(Quiz(
            id=quiz_id,
            author_user_id=author_id,
            title=title,
            category="技術",
            status=status,
        ))
        db.session.commit()


def add_play(app, play_id, quiz_id, user_id, correct, total, submitted_at, status=PlayStatus.submitted):
    with app.app_context():
        db.session.add(QuizPlay(
            id=play_id,
            quiz_id=quiz_id,
            player_user_id=user_id,
            status=status,
            started_at=submitted_at - timedelta(minutes=2),
            submitted_at=submitted_at if status == PlayStatus.submitted else None,
            score=correct,
            correct_answers=correct,
            total_questions=total,
        ))
        db.session.commit()


def test_profile_stats_and_display_name_update():
    app, client = make_client()
    add_user(app, 1, "user@example.com", "Before")
    add_quiz(app, 10, 1, "作成したクイズ")
    add_quiz(app, 11, 1, "2つ目")
    now = datetime.now(timezone.utc)
    add_play(app, 100, 10, 1, 2, 2, now)
    add_play(app, 101, 11, 1, 1, 3, now - timedelta(days=1))
    add_play(app, 102, 11, 1, 0, 0, now, PlayStatus.started)

    profile = client.get("/api/me/profile", headers=headers(app, 1))
    updated = client.patch(
        "/api/me/profile",
        headers=headers(app, 1),
        json={"display_name": "  After  "},
    )
    unchanged = client.patch(
        "/api/me/profile",
        headers=headers(app, 1),
        json={"display_name": "After"},
    )

    assert profile.status_code == 200
    assert profile.get_json()["stats"] == {
        "play_count": 2,
        "attempted_quiz_count": 2,
        "correct_answers": 3,
        "total_questions": 5,
        "average_accuracy_percentage": 60.0,
        "perfect_play_count": 1,
        "created_quiz_count": 2,
    }
    assert updated.get_json()["user"]["display_name"] == "After"
    assert updated.get_json()["meta"]["changed"] is True
    assert unchanged.get_json()["meta"]["changed"] is False


def test_history_is_scoped_sorted_paginated_and_filtered():
    app, client = make_client()
    add_user(app, 1, "user@example.com", "User")
    add_user(app, 2, "other@example.com", "Other")
    add_quiz(app, 10, 1, "公開クイズ")
    add_quiz(app, 11, 1, "非公開クイズ", QuizStatus.archived)
    now = datetime.now(timezone.utc)
    add_play(app, 100, 10, 1, 3, 3, now)
    add_play(app, 101, 11, 1, 3, 4, now - timedelta(hours=1))
    add_play(app, 102, 10, 1, 1, 3, now - timedelta(hours=2))
    add_play(app, 103, 10, 2, 3, 3, now + timedelta(hours=1))

    first = client.get(
        "/api/me/plays",
        headers=headers(app, 1),
        query_string={"page": 1, "per_page": 2},
    ).get_json()
    passed = client.get(
        "/api/me/plays",
        headers=headers(app, 1),
        query_string={"result": "passed"},
    ).get_json()
    review = client.get(
        "/api/me/plays",
        headers=headers(app, 1),
        query_string={"result": "review", "quiz_id": 10},
    ).get_json()

    assert [item["id"] for item in first["items"]] == ["100", "101"]
    assert first["pagination"]["total"] == 3
    assert [item["id"] for item in passed["items"]] == ["101"]
    assert passed["items"][0]["quiz"]["is_replayable"] is False
    assert [item["id"] for item in review["items"]] == ["102"]


def test_play_detail_is_available_only_to_owner():
    app, client = make_client()
    add_user(app, 1, "user@example.com", "User")
    add_user(app, 2, "other@example.com", "Other")
    add_quiz(app, 10, 1, "詳細クイズ")
    add_play(app, 100, 10, 1, 1, 1, datetime.now(timezone.utc))

    with app.app_context():
        db.session.add(Question(
            id=200,
            quiz_id=10,
            body="2 + 2 は？",
            explanation="4になります。",
            sort_order=1,
            points=2,
        ))
        db.session.add_all([
            Choice(id=300, question_id=200, body="3", is_correct=False, sort_order=1),
            Choice(id=301, question_id=200, body="4", is_correct=True, sort_order=2),
        ])
        db.session.add(QuizPlayAnswer(
            id=400,
            quiz_play_id=100,
            question_id=200,
            selected_choice_id=301,
            result=AnswerResult.correct,
            points_awarded=2,
        ))
        db.session.commit()

    own = client.get("/api/me/plays/100", headers=headers(app, 1))
    other = client.get("/api/me/plays/100", headers=headers(app, 2))

    question = own.get_json()["questions"][0]
    assert own.status_code == 200
    assert question["explanation"] == "4になります。"
    assert question["correct_choice_id"] == "301"
    assert question["choices"][1]["is_correct"] is True
    assert other.status_code == 404


def test_profile_requires_active_user_and_valid_filters():
    app, client = make_client()
    add_user(app, 1, "active@example.com", "Active")
    add_user(app, 2, "suspended@example.com", "Suspended", UserStatus.suspended)

    anonymous = client.get("/api/me/profile")
    suspended = client.get("/api/me/profile", headers=headers(app, 2))
    invalid_result = client.get(
        "/api/me/plays",
        headers=headers(app, 1),
        query_string={"result": "unknown"},
    )
    invalid_name = client.patch(
        "/api/me/profile",
        headers=headers(app, 1),
        json={"display_name": " "},
    )

    assert anonymous.status_code == 401
    assert suspended.status_code == 403
    assert suspended.get_json()["error"]["code"] == "auth/account_inactive"
    assert invalid_result.status_code == 400
    assert invalid_name.status_code == 400
