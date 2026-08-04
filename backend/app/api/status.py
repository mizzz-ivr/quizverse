from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify

from ..authz import admin_required
from ..extensions import db
from ..models import EmailSettings

status_bp = Blueprint("status", __name__, url_prefix="/api")

TRUTHY_VALUES = {"1", "true", "yes", "on"}


def _normalize_status(value: str):
    allowed = {"normal", "warning", "outage", "maintenance"}
    if value in allowed:
        return value
    return "normal"


def _iso_utc_now():
    return datetime.now(timezone.utc).isoformat()


def _check_database_status():
    try:
        db.session.execute(db.text("SELECT 1"))
        return {"status": "normal", "message": "DB接続は正常です。"}
    except Exception:
        return {"status": "outage", "message": "DB接続に失敗しました。"}


def _check_auth_status():
    if current_app.config.get("JWT_SECRET_KEY"):
        return {"status": "normal", "message": "認証基盤は有効です。"}
    return {"status": "warning", "message": "JWT設定を確認してください。"}


def _check_mail_status():
    settings = EmailSettings.query.order_by(EmailSettings.id.asc()).first()
    if not settings:
        return {"status": "warning", "message": "SMTP設定が未登録です。"}

    required = [settings.sender_name, settings.sender_email, settings.smtp_host, settings.smtp_username]
    has_required = all(isinstance(value, str) and value.strip() for value in required)
    if not has_required:
        return {"status": "warning", "message": "SMTP必須設定に不足があります。"}

    if settings.use_ssl and settings.use_tls:
        return {"status": "warning", "message": "SMTP設定(TLS/SSL)が矛盾しています。"}

    return {"status": "normal", "message": "SMTP設定は登録済みです。"}


def _maintenance_payload():
    mode = str(current_app.config.get("SERVICE_MAINTENANCE_MODE", "false")).strip().lower() in TRUTHY_VALUES
    status = "maintenance" if mode else "normal"
    return {
        "status": status,
        "title": current_app.config.get("SERVICE_MAINTENANCE_TITLE", "メンテナンス情報はありません"),
        "message": current_app.config.get("SERVICE_MAINTENANCE_MESSAGE", "現在メンテナンス予定はありません。"),
        "scheduled_until": current_app.config.get("SERVICE_MAINTENANCE_SCHEDULED_UNTIL"),
    }


def _compose_status_payload(include_internal: bool = False):
    components = {
        "application": {"status": "normal", "message": "アプリケーションは稼働中です。"},
        "api": {"status": "normal", "message": "APIは稼働中です。"},
        "database": _check_database_status(),
        "auth": _check_auth_status(),
        "mail": _check_mail_status(),
    }
    maintenance = _maintenance_payload()

    levels = [part["status"] for part in components.values()]
    if maintenance["status"] == "maintenance":
        overall_status = "maintenance"
    elif "outage" in levels:
        overall_status = "outage"
    elif "warning" in levels:
        overall_status = "warning"
    else:
        overall_status = "normal"

    payload = {
        "status": {
            "overall": overall_status,
            "updated_at": _iso_utc_now(),
            "components": components,
            "maintenance": maintenance,
        }
    }

    if include_internal:
        payload["status"]["internal"] = {
            "status_source": "application-runtime-check",
            "mail_judgement": "smtp_settings_presence_and_basic_validation",
            "history": "not_implemented_mvp",
        }

    return payload


@status_bp.get("/status")
def get_public_status():
    return jsonify(_compose_status_payload(include_internal=False)), 200


@status_bp.get("/admin/status")
@admin_required
def get_admin_status():
    return jsonify(_compose_status_payload(include_internal=True)), 200
