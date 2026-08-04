from datetime import timedelta
from pathlib import Path

from flask_jwt_extended import create_access_token

from app import create_app
from app.extensions import db
from app.models import AuditLog, User, UserRole, UserStatus


ROOT = Path(__file__).resolve().parents[2]
ADMIN_USER_MANAGEMENT = ROOT / "backend" / "app" / "api" / "admin_user_management.py"


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


def _add_user(app, user_id, email, *, role=UserRole.user, status=UserStatus.active):
    with app.app_context():
        user = User(
            id=user_id,
            email=email,
            display_name=email.split("@")[0],
            role=role,
            status=status,
        )
        user.set_password("safePassword123")
        db.session.add(user)
        db.session.commit()


def _headers(app, user_id):
    with app.app_context():
        token = create_access_token(identity=str(user_id))
    return {"Authorization": f"Bearer {token}"}


def test_user_list_supports_search_role_status_and_pagination():
    app, client = _create_client()
    _add_user(app, 1, "admin@example.com", role=UserRole.admin)
    _add_user(app, 2, "alice@example.com")
    _add_user(app, 3, "archived@example.com", status=UserStatus.suspended)

    response = client.get(
        "/api/admin/users",
        headers=_headers(app, 1),
        query_string={"q": "ali", "role": "user", "status": "active", "page": 1, "per_page": 10},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert [item["id"] for item in payload["items"]] == ["2"]
    assert payload["pagination"]["total"] == 1
    assert payload["filters"] == {"q": "ali", "role": "user", "status": "active"}
    assert "email" not in payload["items"][0]
    assert payload["items"][0]["email_masked"].endswith("@example.com")


def test_role_change_is_audited_with_before_and_after():
    app, client = _create_client()
    _add_user(app, 1, "admin@example.com", role=UserRole.admin)
    _add_user(app, 2, "member@example.com")

    response = client.patch(
        "/api/admin/users/2/role",
        headers=_headers(app, 1),
        json={"role": "admin"},
    )

    assert response.status_code == 200
    assert response.get_json()["user"]["role"] == "admin"
    with app.app_context():
        audit = AuditLog.query.one()
        assert audit.actor_user_id == 1
        assert audit.entity_type == "user"
        assert audit.entity_id == "2"
        assert audit.metadata_json["field"] == "role"
        assert audit.metadata_json["before"] == "user"
        assert audit.metadata_json["after"] == "admin"


def test_self_demotion_and_last_active_admin_changes_are_rejected():
    app, client = _create_client()
    _add_user(app, 1, "admin@example.com", role=UserRole.admin)

    self_response = client.patch(
        "/api/admin/users/1/role",
        headers=_headers(app, 1),
        json={"role": "user"},
    )
    suspend_response = client.patch(
        "/api/admin/users/1/status",
        headers=_headers(app, 1),
        json={"status": "suspended"},
    )

    assert self_response.status_code == 409
    assert self_response.get_json()["error"]["code"] == "admin/self_role_change_forbidden"
    assert suspend_response.status_code == 409
    assert suspend_response.get_json()["error"]["code"] == "admin/self_status_change_forbidden"

    _add_user(app, 2, "second-admin@example.com", role=UserRole.admin)
    demote_second = client.patch(
        "/api/admin/users/2/role",
        headers=_headers(app, 1),
        json={"role": "user"},
    )
    assert demote_second.status_code == 200

    with app.app_context():
        db.session.get(User, 1).role = UserRole.user
        db.session.get(User, 2).role = UserRole.admin
        db.session.commit()

    last_admin = client.patch(
        "/api/admin/users/2/status",
        headers=_headers(app, 2),
        json={"status": "suspended"},
    )
    assert last_admin.status_code == 409
    assert last_admin.get_json()["error"]["code"] == "admin/self_status_change_forbidden"


def test_status_change_is_audited_and_invalid_values_are_rejected():
    app, client = _create_client()
    _add_user(app, 1, "admin@example.com", role=UserRole.admin)
    _add_user(app, 2, "member@example.com")

    invalid = client.patch(
        "/api/admin/users/2/status",
        headers=_headers(app, 1),
        json={"status": "blocked"},
    )
    updated = client.patch(
        "/api/admin/users/2/status",
        headers=_headers(app, 1),
        json={"status": "suspended"},
    )

    assert invalid.status_code == 400
    assert updated.status_code == 200
    assert updated.get_json()["user"]["status"] == "suspended"
    with app.app_context():
        audit = AuditLog.query.one()
        assert audit.metadata_json == {
            "field": "status",
            "before": "active",
            "after": "suspended",
            "actor_role": "admin",
        }


def test_multiple_audit_logs_receive_distinct_ids_in_sqlite_compatibility_schema():
    app, client = _create_client()
    _add_user(app, 1, "admin@example.com", role=UserRole.admin)
    _add_user(app, 2, "member-a@example.com")
    _add_user(app, 3, "member-b@example.com")

    promoted = client.patch(
        "/api/admin/users/2/role",
        headers=_headers(app, 1),
        json={"role": "admin"},
    )
    suspended = client.patch(
        "/api/admin/users/3/status",
        headers=_headers(app, 1),
        json={"status": "suspended"},
    )

    assert promoted.status_code == 200
    assert suspended.status_code == 200
    with app.app_context():
        assert [log.id for log in AuditLog.query.order_by(AuditLog.id).all()] == [1, 2]


def test_postgresql_admin_mutations_use_shared_transaction_advisory_lock():
    source = ADMIN_USER_MANAGEMENT.read_text(encoding="utf-8")

    assert "pg_advisory_xact_lock" in source
    assert "_ADMIN_MUTATION_LOCK_KEY" in source
    assert source.count("_serialize_admin_mutation()") == 3
    assert 'dialect.name == "postgresql"' in source
    assert "id=_audit_log_id_for_current_dialect()" in source


def test_suspended_user_is_rejected_by_login_otp_and_existing_bearer_token():
    app, client = _create_client()
    _add_user(app, 1, "suspended@example.com", status=UserStatus.suspended)
    headers = _headers(app, 1)

    login = client.post(
        "/api/auth/login",
        json={"email": "suspended@example.com", "password": "safePassword123"},
    )
    otp = client.post(
        "/api/auth/otp/request",
        json={"channel": "email", "purpose": "login", "destination": "suspended@example.com"},
    )
    me = client.get("/api/auth/me", headers=headers)
    protected = client.get("/api/auth/protected", headers=headers)

    for response in (login, otp, me, protected):
        assert response.status_code == 403
        assert response.get_json()["error"]["code"] == "auth/account_inactive"


def test_suspended_user_refresh_cookie_is_rejected_after_status_change():
    app, client = _create_client()
    register = client.post(
        "/api/auth/register",
        headers={"Origin": "http://localhost"},
        json={
            "email": "cookie-user@example.com",
            "password": "safePassword123",
            "display_name": "Cookie User",
        },
    )
    assert register.status_code == 201

    with app.app_context():
        user = User.query.filter_by(email="cookie-user@example.com").one()
        user.status = UserStatus.suspended
        db.session.commit()

    csrf_cookie = client.get_cookie("quizverse_csrf_refresh")
    assert csrf_cookie is not None
    response = client.post(
        "/api/auth/refresh",
        headers={"Origin": "http://localhost", "X-CSRF-TOKEN": csrf_cookie.value},
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "auth/account_inactive"