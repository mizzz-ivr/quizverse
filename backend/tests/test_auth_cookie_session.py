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
    JWT_TOKEN_LOCATION = ["cookies", "headers"]
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


def _register(client, email="cookie-user@example.com"):
    return client.post(
        "/api/auth/register",
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


def test_production_auth_response_does_not_expose_jwt_in_json():
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


def test_cookie_protected_mutation_requires_csrf_header():
    _app, client = _create_client()
    assert _register(client).status_code == 201

    response = client.post(
        "/api/quizzes",
        json={
            "title": "CSRF test",
            "questions": [
                {
                    "body": "Question",
                    "choices": [
                        {"body": "Correct", "is_correct": True},
                        {"body": "Wrong", "is_correct": False},
                    ],
                }
            ],
        },
    )

    assert response.status_code == 401
    assert "CSRF" in response.get_json()["error"].get("detail", "")


def test_cookie_protected_mutation_accepts_matching_csrf_header():
    _app, client = _create_client()
    assert _register(client).status_code == 201

    response = client.post(
        "/api/quizzes",
        headers={"X-CSRF-TOKEN": _csrf(client, "quizverse_csrf_access")},
        json={
            "title": "CSRF protected quiz",
            "questions": [
                {
                    "body": "Question",
                    "choices": [
                        {"body": "Correct", "is_correct": True},
                        {"body": "Wrong", "is_correct": False},
                    ],
                }
            ],
        },
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
        headers={"X-CSRF-TOKEN": refresh_csrf},
    )

    assert refresh_response.status_code == 200
    assert refresh_response.get_json()["status"] == "refreshed"
    assert client.get_cookie("quizverse_access_token") is not None
    assert client.get("/api/auth/me").status_code == 200


def test_logout_clears_cookie_session():
    _app, client = _create_client()
    assert _register(client).status_code == 201
    assert client.get_cookie("quizverse_access_token") is not None
    assert client.get_cookie("quizverse_session_hint") is not None

    logout_response = client.post("/api/auth/logout")

    assert logout_response.status_code == 200
    assert logout_response.get_json()["status"] == "logged_out"
    assert client.get_cookie("quizverse_access_token") is None
    assert client.get_cookie("quizverse_refresh_token", path="/api/auth/refresh") is None
    assert client.get_cookie("quizverse_session_hint") is None
    assert client.get("/api/auth/me").status_code == 401
