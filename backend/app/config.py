import os
from datetime import timedelta


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "unsafe-default")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "unsafe-jwt-default")
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        seconds=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_SECONDS", "3600"))
    )
    AUTH_ENABLE_DEV_TOKEN_ENDPOINT = (
        os.getenv("AUTH_ENABLE_DEV_TOKEN_ENDPOINT", "true").lower() == "true"
    )
    GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    EMAIL_SETTINGS_ENCRYPTION_KEY = os.getenv("EMAIL_SETTINGS_ENCRYPTION_KEY")
    QUIZ_PUBLICATION_ENFORCED = (
        os.getenv("QUIZ_PUBLICATION_ENFORCED", "true").lower() == "true"
    )
    SERVICE_MAINTENANCE_MODE = os.getenv("SERVICE_MAINTENANCE_MODE", "false").lower() == "true"
    SERVICE_MAINTENANCE_TITLE = os.getenv("SERVICE_MAINTENANCE_TITLE", "メンテナンス情報はありません")
    SERVICE_MAINTENANCE_MESSAGE = os.getenv("SERVICE_MAINTENANCE_MESSAGE", "現在メンテナンス予定はありません。")
    SERVICE_MAINTENANCE_SCHEDULED_UNTIL = os.getenv("SERVICE_MAINTENANCE_SCHEDULED_UNTIL")
    OTP_EXPIRES_SECONDS = int(os.getenv("OTP_EXPIRES_SECONDS", "300"))
    OTP_MIN_RESEND_SECONDS = int(os.getenv("OTP_MIN_RESEND_SECONDS", "60"))
    OTP_MAX_REQUESTS_PER_HOUR = int(os.getenv("OTP_MAX_REQUESTS_PER_HOUR", "5"))
    OTP_MAX_VERIFY_ATTEMPTS = int(os.getenv("OTP_MAX_VERIFY_ATTEMPTS", "5"))
    OTP_INCLUDE_CODE_IN_RESPONSE = (
        os.getenv("OTP_INCLUDE_CODE_IN_RESPONSE", "false").lower() == "true"
    )
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///quizverse.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
