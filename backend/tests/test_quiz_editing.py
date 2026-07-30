from app import create_app
from app.extensions import db
import app.api.quiz_editing as quiz_editing


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


def _quiz_payload(title="編集前クイズ"):
    return {
        "title": title,
        "description": "編集前の説明",
        "category": "before",
        "questions": [
            {
                "body": "編集前の問題",
                "explanation": "編集前の解説",
                "choices": [
                    {"body": "正解", "is_correct": True},
                    {"body": "不正解", "is_correct": False},
                ],
            }
        ],
    }


def _create_quiz(client, token):
    response = client.post(
        "/api/quizzes",
        headers=_auth_header(token),
        json=_quiz_payload(),
    )
    assert response.status_code == 201
    return response.get_json()["quiz"]["id"]


def _change_status(client, token, quiz_id, status):
    return client.patch(
        f"/api/me/quizzes/{quiz_id}/status",
        headers=_auth_header(token),
        json={"status": status},
    )


def test_owner_can_get_editable_draft_with_correct_answers():
    _app, client = _create_client()
    owner_token = _register(client, "owner@example.com", "Owner")
    quiz_id = _create_quiz(client, owner_token)

    response = client.get(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
    )

    assert response.status_code == 200
    quiz = response.get_json()["quiz"]
    assert quiz["id"] == quiz_id
    assert quiz["status"] == "draft"
    assert quiz["editable"] is True
    assert quiz["questions"][0]["choices"][0]["is_correct"] is True
    assert quiz["questions"][0]["choices"][1]["is_correct"] is False


def test_non_owner_cannot_read_or_update_draft():
    _app, client = _create_client()
    owner_token = _register(client, "owner2@example.com", "Owner2")
    other_token = _register(client, "other@example.com", "Other")
    quiz_id = _create_quiz(client, owner_token)

    get_response = client.get(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(other_token),
    )
    put_response = client.put(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(other_token),
        json=_quiz_payload("第三者の更新"),
    )

    assert get_response.status_code == 404
    assert put_response.status_code == 404
    assert get_response.get_json()["error"]["code"] == "quiz/not_found"
    assert put_response.get_json()["error"]["code"] == "quiz/not_found"


def test_owner_can_replace_draft_content_transactionally():
    _app, client = _create_client()
    owner_token = _register(client, "editor@example.com", "Editor")
    quiz_id = _create_quiz(client, owner_token)
    update_payload = {
        "title": "編集後クイズ",
        "description": "編集後の説明",
        "category": "after",
        "questions": [
            {
                "body": "第1問",
                "explanation": "第1問の解説",
                "choices": [
                    {"body": "A", "is_correct": False},
                    {"body": "B", "is_correct": True},
                    {"body": "C", "is_correct": False},
                ],
            },
            {
                "body": "第2問",
                "explanation": None,
                "choices": [
                    {"body": "正解", "is_correct": True},
                    {"body": "不正解", "is_correct": False},
                ],
            },
        ],
    }

    response = client.put(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
        json=update_payload,
    )

    assert response.status_code == 200
    quiz = response.get_json()["quiz"]
    assert quiz["id"] == quiz_id
    assert quiz["title"] == "編集後クイズ"
    assert quiz["description"] == "編集後の説明"
    assert quiz["category"] == "after"
    assert len(quiz["questions"]) == 2
    assert len(quiz["questions"][0]["choices"]) == 3
    assert quiz["questions"][0]["choices"][1]["is_correct"] is True

    read_back = client.get(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
    ).get_json()["quiz"]
    assert read_back["title"] == "編集後クイズ"
    assert [question["body"] for question in read_back["questions"]] == ["第1問", "第2問"]


def test_invalid_update_keeps_existing_content():
    _app, client = _create_client()
    owner_token = _register(client, "invalid@example.com", "Invalid")
    quiz_id = _create_quiz(client, owner_token)

    response = client.put(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
        json={"title": "", "questions": []},
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "quiz/validation_error"
    current = client.get(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
    ).get_json()["quiz"]
    assert current["title"] == "編集前クイズ"
    assert current["questions"][0]["body"] == "編集前の問題"


def test_non_object_update_payload_returns_json_validation_error():
    _app, client = _create_client()
    owner_token = _register(client, "payload@example.com", "Payload")
    quiz_id = _create_quiz(client, owner_token)

    response = client.put(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
        json=[{"title": "配列は不可"}],
    )

    assert response.status_code == 400
    assert response.is_json
    assert response.get_json()["error"] == {
        "code": "quiz/validation_error",
        "message": "Request body must be a JSON object.",
    }
    current = client.get(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
    ).get_json()["quiz"]
    assert current["title"] == "編集前クイズ"


def test_published_and_archived_quizzes_are_not_directly_editable():
    _app, client = _create_client()
    owner_token = _register(client, "status@example.com", "Status")
    quiz_id = _create_quiz(client, owner_token)
    assert _change_status(client, owner_token, quiz_id, "published").status_code == 200

    published_get = client.get(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
    )
    published_put = client.put(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
        json=_quiz_payload("公開中の更新"),
    )
    assert published_get.status_code == 409
    assert published_put.status_code == 409
    assert published_put.get_json()["error"]["code"] == "quiz/not_editable"

    assert _change_status(client, owner_token, quiz_id, "archived").status_code == 200
    archived_get = client.get(
        f"/api/me/quizzes/{quiz_id}",
        headers=_auth_header(owner_token),
    )
    assert archived_get.status_code == 409
    assert archived_get.get_json()["error"]["code"] == "quiz/not_editable"


def test_play_submission_locks_quiz_without_allocation_mutex(monkeypatch):
    _app, client = _create_client()
    owner_token = _register(client, "lock-owner@example.com", "Lock Owner")
    player_token = _register(client, "lock-player@example.com", "Lock Player")
    quiz_id = _create_quiz(client, owner_token)
    assert _change_status(client, owner_token, quiz_id, "published").status_code == 200

    locked_quiz_ids = []
    original_quiz_lock = quiz_editing._lock_quiz

    def unexpected_allocation_lock():
        raise AssertionError("play submission must not acquire the allocation mutex")

    def tracked_quiz_lock(locked_quiz_id):
        locked_quiz_ids.append(locked_quiz_id)
        return original_quiz_lock(locked_quiz_id)

    monkeypatch.setattr(
        quiz_editing,
        "_lock_shared_id_allocation",
        unexpected_allocation_lock,
    )
    monkeypatch.setattr(quiz_editing, "_lock_quiz", tracked_quiz_lock)

    detail = client.get(f"/api/quizzes/{quiz_id}").get_json()["quiz"]
    question = detail["questions"][0]
    response = client.post(
        f"/api/quizzes/{quiz_id}/play",
        headers=_auth_header(player_token),
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
    assert locked_quiz_ids == [int(quiz_id)]
