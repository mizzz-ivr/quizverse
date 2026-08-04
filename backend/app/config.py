import os
from datetime import timedelta


def _env_bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() == "true"


def _env_list(name: str, default: str) -> list[str]:
    values = [value.strip() for value in os.getenv(name, default).split(",")]
    return [value for value in values if value]


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "unsafe-default")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "unsafe-jwt-default")
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        seconds=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_SECONDS", "900"))
    )
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(
        seconds=int(os.getenv("JWT_REFRESH_TOKEN_EXPIRES_SECONDS", "2592000"))
    )

    # Header JWT is checked first so API clients that intentionally send a
    # bearer token are not shadowed by cookies retained from a prior login.
    JWT_TOKEN_LOCATION = _env_list("JWT_TOKEN_LOCATION", "headers,cookies")
    JWT_COOKIE_SECURE = _env_bool("JWT_COOKIE_SECURE", "false")
    JWT_COOKIE_SAMESITE = os.getenv("JWT_COOKIE_SAMESITE", "Lax")
    JWT_COOKIE_DOMAIN = os.getenv("JWT_COOKIE_DOMAIN") or None
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

    AUTH_TRUSTED_ORIGINS = _env_list("AUTH_TRUSTED_ORIGINS", "")
    AUTH_EXPOSE_TOKEN_IN_RESPONSE = _env_bool(
        "AUTH_EXPOSE_TOKEN_IN_RESPONSE", "false"
    )
    AUTH_ENABLE_DEV_TOKEN_ENDPOINT = _env_bool(
        "AUTH_ENABLE_DEV_TOKEN_ENDPOINT", "true"
    )
    ADMIN_BOOTSTRAP_EMAILS = [
        value.lower() for value in _env_list("ADMIN_BOOTSTRAP_EMAILS", "")
    ]
    GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    EMAIL_SETTINGS_ENCRYPTION_KEY = os.getenv("EMAIL_SETTINGS_ENCRYPTION_KEY")
    QUIZ_PUBLICATION_ENFORCED = _env_bool("QUIZ_PUBLICATION_ENFORCED", "true")
    SERVICE_MAINTENANCE_MODE = _env_bool("SERVICE_MAINTENANCE_MODE", "false")
    SERVICE_MAINTENANCE_TITLE = os.getenv(
        "SERVICE_MAINTENANCE_TITLE", "メンテナンス情報はありません"
    )
    SERVICE_MAINTENANCE_MESSAGE = os.getenv(
        "SERVICE_MAINTENANCE_MESSAGE", "現在メンテナンス予定はありません。"
    )
    SERVICE_MAINTENANCE_SCHEDULED_UNTIL = os.getenv(
        "SERVICE_MAINTENANCE_SCHEDULED_UNTIL"
    )
    OTP_EXPIRES_SECONDS = int(os.getenv("OTP_EXPIRES_SECONDS", "300"))
    OTP_MIN_RESEND_SECONDS = int(os.getenv("OTP_MIN_RESEND_SECONDS", "60"))
    OTP_MAX_REQUESTS_PER_HOUR = int(
        os.getenv("OTP_MAX_REQUESTS_PER_HOUR", "5")
    )
    OTP_MAX_VERIFY_ATTEMPTS = int(os.getenv("OTP_MAX_VERIFY_ATTEMPTS", "5"))
    OTP_INCLUDE_CODE_IN_RESPONSE = _env_bool(
        "OTP_INCLUDE_CODE_IN_RESPONSE", "false"
    )
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///quizverse.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
