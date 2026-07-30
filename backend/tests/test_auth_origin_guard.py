from datetime import timedelta

from app import create_app
from app.extensions import db
from app.models import User


class OriginGuardTestConfig:
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
    AUTH_TRUSTED_ORIGINS = ["http://localhost:5173"]
    AUTH_EXPOSE_TOKEN_IN_RESPONSE = False
    AUTH_ENABLE_DEV_TOKEN_ENDPOINT = True
    GOOGLE_OAUTH_CLIENT_ID = "google-client-id.apps.googleusercontent.com"
    OTP_EXPIRES_SECONDS = 300
    OTP_MIN_RESEND_SECONDS = 60
    OTP_MAX_REQUESTS_PER_HOUR = 5
    OTP_MAX_VERIFY_ATTEMPTS = 5
    OTP_INCLUDE_CODE_IN_RESPONSE = True
    QUIZ_PUBLICATION_ENFORCED = True


def _create_client():
    app = create_app(OriginGuardTestConfig)
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _registration_payload(email):
    return {
        "email": email,
        "password": "safePassword123",
        "display_name": "Origin Guard User",
    }


def test_untrusted_origin_is_rejected_before_registration_commit():
    app, client = _create_client()
    email = "origin-guard@example.com"

    rejected = client.post(
        "/api/auth/register",
        headers={"Origin": "https://attacker.example"},
        json=_registration_payload(email),
    )

    assert rejected.status_code == 403
    assert rejected.get_json()["error"]["code"] == "auth/untrusted_origin"
    with app.app_context():
        assert User.query.filter_by(email=email).first() is None

    accepted = client.post(
        "/api/auth/register",
        headers={"Origin": "http://localhost:5173"},
        json=_registration_payload(email),
    )
    assert accepted.status_code == 201


def test_untrusted_origin_is_rejected_before_google_validation():
    app, client = _create_client()

    response = client.post(
        "/api/auth/google",
        headers={"Origin": "https://attacker.example"},
        json={"id_token": "untrusted-origin-must-not-be-validated"},
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "auth/untrusted_origin"
    with app.app_context():
        assert User.query.count() == 0
