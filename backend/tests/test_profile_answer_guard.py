from datetime import datetime, timezone

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
    ADMIN_BOOTSTRAP_EMAILS = []


def make_client():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
        user = User(
            id=1,
            email="player@example.com",
            display_name="Player",
            role=UserRole.user,
            status=UserStatus.active,
        )
        quiz = Quiz(
            id=10,
            author_user_id=1,
            title="公開中クイズ",
            status=QuizStatus.published,
        )
        question = Question(
            id=20,
            quiz_id=10,
            body="正解は？",
            explanation="本来の解説",
            sort_order=1,
            points=1,
        )
        db.session.add_all([
            user,
            quiz,
            question,
            Choice(id=30, question_id=20, body="A", is_correct=False, sort_order=1),
            Choice(id=31, question_id=20, body="B", is_correct=True, sort_order=2),
            QuizPlay(
                id=40,
                quiz_id=10,
                player_user_id=1,
                status=PlayStatus.submitted,
                started_at=datetime.now(timezone.utc),
                submitted_at=datetime.now(timezone.utc),
                score=0,
                correct_answers=0,
                total_questions=1,
            ),
            QuizPlayAnswer(
                id=50,
                quiz_play_id=40,
                question_id=20,
                selected_choice_id=None,
                result=AnswerResult.skipped,
                points_awarded=0,
            ),
        ])
        db.session.commit()
        token = create_access_token(identity="1")
    return app, app.test_client(), {"Authorization": f"Bearer {token}"}


def test_published_quiz_hides_answer_key_until_it_is_not_replayable():
    app, client, auth = make_client()

    published = client.get("/api/me/plays/40", headers=auth)
    published_payload = published.get_json()
    published_question = published_payload["questions"][0]

    assert published.status_code == 200
    assert published_payload["review"] == {
        "answer_key_unlocked": False,
        "locked_reason": "quiz_is_published",
    }
    assert published_question["correct_choice_id"] is None
    assert published_question["explanation"] is None
    assert all(choice["is_correct"] is False for choice in published_question["choices"])

    with app.app_context():
        db.session.get(Quiz, 10).status = QuizStatus.archived
        db.session.commit()

    archived = client.get("/api/me/plays/40", headers=auth)
    archived_payload = archived.get_json()
    archived_question = archived_payload["questions"][0]

    assert archived_payload["review"] == {
        "answer_key_unlocked": True,
        "locked_reason": None,
    }
    assert archived_question["correct_choice_id"] == "31"
    assert archived_question["explanation"] == "本来の解説"
    assert archived_question["choices"][1]["is_correct"] is True
