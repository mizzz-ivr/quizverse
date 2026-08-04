from app import create_app
from app.extensions import db
from app.models import User, UserRole, UserStatus


class TestConfig:
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = "test"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-32-plus-bytes"
    ADMIN_BOOTSTRAP_EMAILS = ["root@example.com"]


def _client():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _register(client, email):
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "safePassword123", "display_name": email.split("@")[0]},
    )
    assert response.status_code == 201
    return response.get_json()["access_token"]


def _headers(token, **extra):
    return {"Authorization": f"Bearer {token}", **extra}


def _admin_token(client):
    token = _register(client, "root@example.com")
    assert client.get("/api/admin/session", headers=_headers(token)).status_code == 200
    return token


def test_admin_endpoints_require_authenticated_admin():
    _app, client = _client()
    assert client.get("/api/admin/overview").status_code == 401

    member = _register(client, "member@example.com")
    forbidden = client.get(
        "/api/admin/overview",
        headers=_headers(member, **{"X-Admin-Mode": "true"}),
    )
    assert forbidden.status_code == 403
    assert forbidden.get_json()["error"]["code"] == "admin/forbidden"


def test_bootstrap_email_is_persisted_as_admin():
    app, client = _client()
    token = _admin_token(client)

    response = client.get("/api/admin/session", headers=_headers(token))
    assert response.get_json()["user"]["role"] == "admin"
    with app.app_context():
        assert User.query.filter_by(email="root@example.com").one().role == UserRole.admin


def test_inactive_admin_is_rejected():
    app, client = _client()
    token = _admin_token(client)
    with app.app_context():
        user = User.query.filter_by(email="root@example.com").one()
        user.status = UserStatus.suspended
        db.session.commit()

    response = client.get("/api/admin/session", headers=_headers(token))
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "auth/account_inactive"


def test_admin_overview_users_and_pagination():
    _app, client = _client()
    admin = _admin_token(client)
    _register(client, "member@example.com")

    overview = client.get("/api/admin/overview", headers=_headers(admin))
    assert overview.status_code == 200
    assert overview.get_json()["permission"] == {"mode": "rbac", "role": "admin"}

    users = client.get(
        "/api/admin/users",
        headers=_headers(admin),
        query_string={"page": 1, "per_page": 10},
    )
    assert users.status_code == 200
    items = users.get_json()["items"]
    assert {item["role"] for item in items} == {"admin", "user"}
    assert all("email" not in item and "password_hash" not in item for item in items)

    invalid = client.get(
        "/api/admin/users",
        headers=_headers(admin),
        query_string={"page": 0},
    )
    assert invalid.status_code == 400


def test_admin_email_settings_are_rbac_protected_and_masked():
    _app, client = _client()
    headers = _headers(_admin_token(client))
    payload = {
        "sender_name": "QuizVerse",
        "sender_email": "notify@example.com",
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_username": "smtp-user",
        "smtp_password": "test-value",
        "use_tls": True,
        "use_ssl": False,
    }

    saved = client.put("/api/admin/email-settings", headers=headers, json=payload)
    assert saved.status_code == 200
    assert saved.get_json()["meta"]["permission"] == "rbac"

    loaded = client.get("/api/admin/email-settings", headers=headers).get_json()
    assert loaded["email_settings"]["smtp_password_masked"] == "********"
    assert "smtp_password" not in loaded["email_settings"]
