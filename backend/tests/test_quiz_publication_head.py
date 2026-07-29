from app import create_app
from app.extensions import db


class TestConfig:
    TESTING = True
    QUIZ_PUBLICATION_ENFORCED = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = "test"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-32-plus-bytes"


def _setup():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
    client = app.test_client()
    register = client.post(
        "/api/auth/register",
        json={
            "email": "head-owner@example.com",
            "password": "safePassword123",
            "display_name": "HEAD Owner",
        },
    )
    assert register.status_code == 201
    token = register.get_json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/quizzes",
        headers=headers,
        json={
            "title": "HEAD Boundary Quiz",
            "questions": [
                {
                    "body": "HEADでも隠れる？",
                    "choices": [
                        {"body": "はい", "is_correct": True},
                        {"body": "いいえ", "is_correct": False},
                    ],
                }
            ],
        },
    )
    assert created.status_code == 201
    return client, headers, created.get_json()["quiz"]["id"]


def test_head_hides_unpublished_quiz_from_anonymous_users():
    client, _headers, quiz_id = _setup()

    assert client.head(f"/api/quizzes/{quiz_id}").status_code == 404
    assert client.head(f"/api/quizzes/{quiz_id}/rankings").status_code == 404


def test_head_allows_published_quiz_routes():
    client, headers, quiz_id = _setup()
    published = client.patch(
        f"/api/me/quizzes/{quiz_id}/status",
        headers=headers,
        json={"status": "published"},
    )
    assert published.status_code == 200

    assert client.head(f"/api/quizzes/{quiz_id}").status_code == 200
    assert client.head(f"/api/quizzes/{quiz_id}/rankings").status_code == 200
