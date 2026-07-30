from datetime import timedelta

from app import create_app
from app.extensions import db


class CookieTestConfig:
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
    GOOGLE_OAUTH_CLIENT_ID = "google-client-id.apps.googleusercontent.com"
    OTP_EXPIRES_SECONDS = 300
    OTP_MIN_RESEND_SECONDS = 60
    OTP_MAX_REQUESTS_PER_HOUR = 5
    OTP_MAX_VERIFY_ATTEMPTS = 5
    OTP_INCLUDE_CODE_IN_RESPONSE = True
    QUIZ_PUBLICATION_ENFORCED = True


class ProductionCookieTestConfig(CookieTestConfig):
    TESTING = False


def _create_client(config=CookieTestConfig):
    app = create_app(config)
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _register(
    client,
    email="cookie-user@example.com",
    *,
    origin="http://localhost",
):
    headers = {"Origin": origin} if origin is not None else {}
    return client.post(
        "/api/auth/register",
        headers=headers,
        json={
            "email": email,
            "password": "safePassword123",
            "display_name": "Cookie User",
        },
    )


def _csrf(client, name):
    cookie = client.get_cookie(name)
    assert cookie is not None
    return cookie.value


def _quiz_payload(title="Cookie quiz"):
    return {
        "title": title,
        "questions": [
            {
                "body": "Question",
                "choices": [
                    {"body": "Correct", "is_correct": True},
                    {"body": "Wrong", "is_correct": False},
                ],
            }
        ],
    }


def test_register_sets_http_only_access_and_refresh_cookies():
    _app, client = _create_client()

    response = _register(client)

    assert response.status_code == 201
    set_cookie_headers = response.headers.getlist("Set-Cookie")
    access_cookie = next(
        header for header in set_cookie_headers
        if header.startswith("quizverse_access_token=")
    )
    refresh_cookie = next(
        header for header in set_cookie_headers
        if header.startswith("quizverse_refresh_token=")
    )
    access_csrf_cookie = next(
        header for header in set_cookie_headers
        if header.startswith("quizverse_csrf_access=")
    )
    session_hint_cookie = next(
        header for header in set_cookie_headers
        if header.startswith("quizverse_session_hint=")
    )

    assert "HttpOnly" in access_cookie
    assert "HttpOnly" in refresh_cookie
    assert "SameSite=Lax" in access_cookie
    assert "HttpOnly" not in access_csrf_cookie
    assert "HttpOnly" not in session_hint_cookie


def test_configured_frontend_origin_can_receive_cookie_session():
    class TrustedFrontendConfig(CookieTestConfig):
        AUTH_TRUSTED_ORIGINS = ["http://localhost:5173"]

    _app, client = _create_client(TrustedFrontendConfig)

    response = _register(
        client,
        "trusted-frontend@example.com",
        origin="http://localhost:5173",
    )

    assert response.status_code == 201
    assert client.get_cookie("quizverse_access_token") is not None


def test_cross_origin_login_is_rejected_without_installing_cookies():
    _app, client = _create_client()
    register_response = _register(
        client,
        "cross-origin@example.com",
        origin=None,
    )
    assert register_response.status_code == 201
    assert client.get_cookie("quizverse_access_token") is None

    response = client.post(
        "/api/auth/login",
        headers={"Origin": "https://attacker.example"},
        json={
            "email": "cross-origin@example.com",
            "password": "safePassword123",
        },
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "auth/untrusted_origin"
    assert client.get_cookie("quizverse_access_token") is None
    assert client.get_cookie("quizverse_refresh_token", path="/api/auth/refresh") is None


def test_non_browser_login_retains_bearer_response_without_cookie_session():
    _app, client = _create_client(ProductionCookieTestConfig)

    response = _register(client, "api-client@example.com", origin=None)

    assert response.status_code == 201
    payload = response.get_json()
    assert payload["access_token"]
    assert payload["token_type"] == "Bearer"
    assert client.get_cookie("quizverse_access_token") is None


def test_production_browser_auth_response_does_not_expose_jwt_in_json():
    _app, client = _create_client(ProductionCookieTestConfig)

    response = _register(client, "production-cookie@example.com")

    assert response.status_code == 201
    payload = response.get_json()
    assert "access_token" not in payload
    assert "refresh_token" not in payload
    assert payload["token_type"] == "Cookie"
    assert payload["user"]["email"] == "production-cookie@example.com"


def test_cookie_authentication_reads_me_without_authorization_header():
    _app, client = _create_client()
    assert _register(client).status_code == 201

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.get_json()["user"]["email"] == "cookie-user@example.com"


def test_bearer_header_wins_when_client_also_has_another_users_cookies():
    _app, client = _create_client()
    assert _register(client, "cookie-owner@example.com").status_code == 201

    bearer_user = _register(client, "bearer-owner@example.com", origin=None)
    bearer_token = bearer_user.get_json()["access_token"]

    me_response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {bearer_token}"},
    )
    quiz_response = client.post(
        "/api/quizzes",
        headers={"Authorization": f"Bearer {bearer_token}"},
        json=_quiz_payload("Bearer priority"),
    )

    assert me_response.status_code == 200
    assert me_response.get_json()["user"]["email"] == "bearer-owner@example.com"
    assert quiz_response.status_code == 201
    assert quiz_response.get_json()["quiz"]["title"] == "Bearer priority"


def test_cookie_protected_mutation_requires_csrf_header():
    _app, client = _create_client()
    assert _register(client).status_code == 201

    response = client.post("/api/quizzes", json=_quiz_payload("CSRF test"))

    assert response.status_code == 401
    assert "CSRF" in response.get_json()["error"].get("detail", "")


def test_cookie_protected_mutation_accepts_matching_csrf_header():
    _app, client = _create_client()
    assert _register(client).status_code == 201

    response = client.post(
        "/api/quizzes",
        headers={"X-CSRF-TOKEN": _csrf(client, "quizverse_csrf_access")},
        json=_quiz_payload("CSRF protected quiz"),
    )

    assert response.status_code == 201
    assert response.get_json()["quiz"]["title"] == "CSRF protected quiz"


def test_refresh_cookie_issues_new_access_cookie():
    _app, client = _create_client()
    assert _register(client).status_code == 201
    refresh_csrf = _csrf(client, "quizverse_csrf_refresh")

    client.delete_cookie("quizverse_access_token", path="/")
    client.delete_cookie("quizverse_csrf_access", path="/")
    assert client.get("/api/auth/me").status_code == 401

    refresh_response = client.post(
        "/api/auth/refresh",
        headers={
            "Origin": "http://localhost",
            "X-CSRF-TOKEN": refresh_csrf,
        },
    )

    assert refresh_response.status_code == 200
    assert refresh_response.get_json()["status"] == "refreshed"
    assert client.get_cookie("quizverse_access_token") is not None
    assert client.get("/api/auth/me").status_code == 200


def test_cross_origin_logout_is_rejected_even_without_session_cookies():
    _app, client = _create_client()

    response = client.post(
        "/api/auth/logout",
        headers={"Origin": "https://attacker.example"},
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "auth/untrusted_origin"


def test_logout_rejects_missing_csrf_while_session_exists():
    _app, client = _create_client()
    assert _register(client).status_code == 201

    response = client.post(
        "/api/auth/logout",
        headers={"Origin": "http://localhost"},
    )

    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "auth/csrf_failed"
    assert client.get_cookie("quizverse_access_token") is not None
    assert client.get_cookie("quizverse_session_hint") is not None


def test_logout_clears_cookie_session_with_access_csrf():
    _app, client = _create_client()
    assert _register(client).status_code == 201
    access_csrf = _csrf(client, "quizverse_csrf_access")

    logout_response = client.post(
        "/api/auth/logout",
        headers={
            "Origin": "http://localhost",
            "X-CSRF-TOKEN": access_csrf,
        },
    )

    assert logout_response.status_code == 200
    assert logout_response.get_json()["status"] == "logged_out"
    assert client.get_cookie("quizverse_access_token") is None
    assert client.get_cookie("quizverse_refresh_token", path="/api/auth/refresh") is None
    assert client.get_cookie("quizverse_session_hint") is None
    assert client.get("/api/auth/me").status_code == 401


def test_logout_accepts_refresh_csrf_after_access_cookie_is_gone():
    _app, client = _create_client()
    assert _register(client).status_code == 201
    refresh_csrf = _csrf(client, "quizverse_csrf_refresh")
    client.delete_cookie("quizverse_access_token", path="/")
    client.delete_cookie("quizverse_csrf_access", path="/")

    response = client.post(
        "/api/auth/logout",
        headers={
            "Origin": "http://localhost",
            "X-CSRF-TOKEN": refresh_csrf,
        },
    )

    assert response.status_code == 200
    assert client.get_cookie("quizverse_refresh_token", path="/api/auth/refresh") is None
    assert client.get_cookie("quizverse_session_hint") is None


def test_logout_without_session_is_idempotent_for_same_origin_browser():
    _app, client = _create_client()

    response = client.post(
        "/api/auth/logout",
        headers={"Origin": "http://localhost"},
    )

    assert response.status_code == 200
    assert response.get_json()["status"] == "logged_out"
