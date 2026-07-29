from app import create_app
from app.extensions import db


class TestConfig:
    TESTING = True
    QUIZ_PUBLICATION_ENFORCED = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = "test"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-32-plus-bytes"


def _create_client():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def _register(client, email, display_name):
    response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "safePassword123",
            "display_name": display_name,
        },
    )
    assert response.status_code == 201
    return response.get_json()["access_token"]


def _create_quiz(client, token, title="Publication Quiz"):
    response = client.post(
        "/api/quizzes",
        headers=_auth_header(token),
        json={
            "title": title,
            "description": "公開管理テスト",
            "category": "test",
            "questions": [
                {
                    "body": "正解はどれ？",
                    "choices": [
                        {"body": "A", "is_correct": True},
                        {"body": "B", "is_correct": False},
                    ],
                }
            ],
        },
    )
    assert response.status_code == 201
    return response.get_json()["quiz"]["id"]


def _change_status(client, token, quiz_id, status):
    return client.patch(
        f"/api/me/quizzes/{quiz_id}/status",
        headers=_auth_header(token),
        json={"status": status},
    )


def _submit_correct_play(client, token, quiz_id):
    detail_response = client.get(f"/api/quizzes/{quiz_id}")
    assert detail_response.status_code == 200
    question = detail_response.get_json()["quiz"]["questions"][0]
    response = client.post(
        f"/api/quizzes/{quiz_id}/play",
        headers=_auth_header(token),
        json={
            "answers": [
                {
                    "question_id": question["id"],
                    "selected_choice_id": question["choices"][0]["id"],
                }
            ]
        },
    )
    assert response.status_code == 201


def test_draft_is_hidden_from_public_but_owner_can_preview():
    _app, client = _create_client()
    owner_token = _register(client, "owner@example.com", "Owner")
    other_token = _register(client, "other@example.com", "Other")
    quiz_id = _create_quiz(client, owner_token)

    list_response = client.get("/api/quizzes")
    assert list_response.status_code == 200
    assert list_response.get_json()["items"] == []

    anonymous_detail = client.get(f"/api/quizzes/{quiz_id}")
    assert anonymous_detail.status_code == 404

    other_detail = client.get(
        f"/api/quizzes/{quiz_id}",
        headers=_auth_header(other_token),
    )
    assert other_detail.status_code == 404

    owner_detail = client.get(
        f"/api/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
    )
    assert owner_detail.status_code == 200
    preview = owner_detail.get_json()["quiz"]
    assert preview["status"] == "draft"
    assert preview["viewer_is_author"] is True
    assert preview["play_enabled"] is False
    assert "is_correct" not in preview["questions"][0]["choices"][0]

    play_response = client.post(
        f"/api/quizzes/{quiz_id}/play",
        headers=_auth_header(owner_token),
        json={"answers": []},
    )
    assert play_response.status_code == 404

    ranking_response = client.get(f"/api/quizzes/{quiz_id}/rankings")
    assert ranking_response.status_code == 404


def test_owner_can_list_publish_archive_and_restore_quizzes():
    _app, client = _create_client()
    owner_token = _register(client, "manager@example.com", "Manager")
    quiz_id = _create_quiz(client, owner_token, title="Lifecycle Quiz")

    my_response = client.get(
        "/api/me/quizzes",
        headers=_auth_header(owner_token),
        query_string={"status": "draft"},
    )
    assert my_response.status_code == 200
    body = my_response.get_json()
    assert body["pagination"]["total"] == 1
    assert body["items"][0]["status"] == "draft"
    assert body["items"][0]["public_path"] is None

    publish_response = _change_status(client, owner_token, quiz_id, "published")
    assert publish_response.status_code == 200
    published = publish_response.get_json()["quiz"]
    assert published["previous_status"] == "draft"
    assert published["status"] == "published"
    assert published["published_at"] is not None

    public_list = client.get("/api/quizzes").get_json()
    assert public_list["pagination"]["total"] == 1
    assert public_list["items"][0]["id"] == quiz_id
    assert client.get(f"/api/quizzes/{quiz_id}").status_code == 200

    archive_response = _change_status(client, owner_token, quiz_id, "archived")
    assert archive_response.status_code == 200
    assert archive_response.get_json()["quiz"]["status"] == "archived"
    assert client.get(f"/api/quizzes/{quiz_id}").status_code == 404
    assert client.get("/api/quizzes").get_json()["pagination"]["total"] == 0

    draft_response = _change_status(client, owner_token, quiz_id, "draft")
    assert draft_response.status_code == 200
    assert draft_response.get_json()["quiz"]["status"] == "draft"


def test_repeating_same_status_is_idempotent():
    _app, client = _create_client()
    owner_token = _register(client, "idempotent@example.com", "Idempotent")
    quiz_id = _create_quiz(client, owner_token)

    first = _change_status(client, owner_token, quiz_id, "published")
    assert first.status_code == 200
    first_published_at = first.get_json()["quiz"]["published_at"]

    second = _change_status(client, owner_token, quiz_id, "published")
    assert second.status_code == 200
    repeated = second.get_json()["quiz"]
    assert repeated["previous_status"] == "published"
    assert repeated["status"] == "published"
    assert repeated["published_at"] == first_published_at


def test_non_owner_cannot_change_quiz_status():
    _app, client = _create_client()
    owner_token = _register(client, "owner2@example.com", "Owner2")
    other_token = _register(client, "other2@example.com", "Other2")
    quiz_id = _create_quiz(client, owner_token)

    response = _change_status(client, other_token, quiz_id, "published")

    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "quiz/not_found"


def test_invalid_status_transition_is_rejected():
    _app, client = _create_client()
    owner_token = _register(client, "transition@example.com", "Transition")
    quiz_id = _create_quiz(client, owner_token)
    assert _change_status(client, owner_token, quiz_id, "published").status_code == 200

    response = _change_status(client, owner_token, quiz_id, "draft")

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "quiz/invalid_status_transition"


def test_overall_rankings_only_include_currently_published_quizzes():
    _app, client = _create_client()
    owner_token = _register(client, "ranking-owner@example.com", "Ranking Owner")
    player_token = _register(client, "ranking-player@example.com", "Ranking Player")

    visible_quiz_id = _create_quiz(client, owner_token, title="Visible Quiz")
    hidden_quiz_id = _create_quiz(client, owner_token, title="Hidden Quiz")
    assert _change_status(client, owner_token, visible_quiz_id, "published").status_code == 200
    assert _change_status(client, owner_token, hidden_quiz_id, "published").status_code == 200

    _submit_correct_play(client, player_token, visible_quiz_id)
    _submit_correct_play(client, player_token, hidden_quiz_id)
    assert _change_status(client, owner_token, hidden_quiz_id, "archived").status_code == 200

    response = client.get("/api/rankings")

    assert response.status_code == 200
    ranking = response.get_json()
    assert ranking["pagination"]["total"] == 1
    assert ranking["items"][0]["total_score"] == 1
    assert ranking["items"][0]["quiz_count"] == 1
    assert ranking["aggregation"] == "published_quiz_best_play_per_user_then_sum"
