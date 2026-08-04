from email.utils import parseaddr

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func

from ..authz import admin_required
from ..extensions import db
from ..models import EmailSettings, PlayStatus, Quiz, QuizPlay, User

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

DEFAULT_PAGE = 1
DEFAULT_PER_PAGE = 20
MAX_PER_PAGE = 50


def _error_response(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def _validate_pagination(query_params):
    page_raw = query_params.get("page", str(DEFAULT_PAGE))
    per_page_raw = query_params.get("per_page", str(DEFAULT_PER_PAGE))

    try:
        page = int(page_raw)
    except (TypeError, ValueError):
        return None, _error_response("admin/validation_error", "page must be an integer.", 400)

    if page < 1:
        return None, _error_response("admin/validation_error", "page must be 1 or greater.", 400)

    try:
        per_page = int(per_page_raw)
    except (TypeError, ValueError):
        return None, _error_response("admin/validation_error", "per_page must be an integer.", 400)

    if per_page < 1 or per_page > MAX_PER_PAGE:
        return None, _error_response(
            "admin/validation_error",
            f"per_page must be between 1 and {MAX_PER_PAGE}.",
            400,
        )

    return {"page": page, "per_page": per_page}, None


def _serialize_pagination(page: int, per_page: int, total: int):
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": (total + per_page - 1) // per_page if total else 0,
    }


def _mask_email(email: str):
    local, _, domain = email.partition("@")
    if not local or not domain:
        return "***"
    if len(local) <= 2:
        return f"{local[0]}***@{domain}"
    return f"{local[:2]}***@{domain}"


def _validate_email_settings_payload(payload):
    required_fields = ["sender_name", "sender_email", "smtp_host", "smtp_username"]
    for field in required_fields:
        value = payload.get(field)
        if not isinstance(value, str) or not value.strip():
            return f"{field} is required."

    _, parsed_email = parseaddr(payload.get("sender_email", ""))
    if "@" not in parsed_email:
        return "sender_email must be a valid email address."

    smtp_port = payload.get("smtp_port")
    if not isinstance(smtp_port, int) or smtp_port < 1 or smtp_port > 65535:
        return "smtp_port must be an integer between 1 and 65535."

    use_tls = payload.get("use_tls")
    use_ssl = payload.get("use_ssl")
    if not isinstance(use_tls, bool) or not isinstance(use_ssl, bool):
        return "use_tls and use_ssl must be boolean."

    if use_tls and use_ssl:
        return "use_tls and use_ssl cannot both be true."

    smtp_password = payload.get("smtp_password", "")
    if smtp_password is not None and not isinstance(smtp_password, str):
        return "smtp_password must be a string."

    return None


@admin_bp.get("/session")
@admin_required
def get_admin_session():
    user = g.current_user
    return jsonify(
        {
            "user": {
                "id": str(user.id),
                "email": user.email,
                "display_name": user.display_name,
                "status": user.status.value,
                "role": user.role.value,
            }
        }
    )


@admin_bp.get("/overview")
@admin_required
def get_admin_overview():
    user_count = int(db.session.query(func.count(User.id)).scalar() or 0)
    quiz_count = int(db.session.query(func.count(Quiz.id)).scalar() or 0)
    play_count = int(db.session.query(func.count(QuizPlay.id)).scalar() or 0)
    submitted_play_count = int(
        db.session.query(func.count(QuizPlay.id))
        .filter(QuizPlay.status == PlayStatus.submitted)
        .scalar()
        or 0
    )

    health_check = {"status": "ok", "latency_ms": 20}
    try:
        db.session.execute(db.text("SELECT 1"))
        database_check = {"status": "ok", "latency_ms": 12}
    except Exception:
        database_check = {"status": "error", "latency_ms": None}

    return jsonify(
        {
            "summary": {
                "users": user_count,
                "quizzes": quiz_count,
                "plays": play_count,
                "ranking_entries": submitted_play_count,
            },
            "services": {
                "api": health_check,
                "database": database_check,
                "mail_delivery": {
                    "status": "warning",
                    "latency_ms": None,
                    "note": "MVPではメール到達確認は未実装",
                },
            },
            "permission": {
                "mode": "rbac",
                "role": g.current_user.role.value,
            },
        }
    )


@admin_bp.get("/users")
@admin_required
def get_admin_users():
    validated, validation_error = _validate_pagination(request.args)
    if validation_error:
        return validation_error

    page = validated["page"]
    per_page = validated["per_page"]
    offset = (page - 1) * per_page

    total = int(db.session.query(func.count(User.id)).scalar() or 0)
    users = (
        User.query.order_by(User.created_at.desc(), User.id.desc())
        .offset(offset)
        .limit(per_page)
        .all()
    )

    items = [
        {
            "id": str(user.id),
            "display_name": user.display_name,
            "email_masked": _mask_email(user.email),
            "status": user.status.value,
            "role": user.role.value,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        }
        for user in users
    ]

    return jsonify({"items": items, "pagination": _serialize_pagination(page, per_page, total)})


@admin_bp.get("/quizzes")
@admin_required
def get_admin_quizzes():
    validated, validation_error = _validate_pagination(request.args)
    if validation_error:
        return validation_error

    page = validated["page"]
    per_page = validated["per_page"]
    offset = (page - 1) * per_page

    base_query = (
        db.session.query(Quiz, User.display_name, func.count(QuizPlay.id).label("play_count"))
        .join(User, User.id == Quiz.author_user_id)
        .outerjoin(QuizPlay, QuizPlay.quiz_id == Quiz.id)
        .group_by(Quiz.id, User.display_name)
    )
    total = int(db.session.query(func.count(Quiz.id)).scalar() or 0)
    rows = (
        base_query.order_by(Quiz.created_at.desc(), Quiz.id.desc())
        .offset(offset)
        .limit(per_page)
        .all()
    )

    items = [
        {
            "id": str(quiz.id),
            "title": quiz.title,
            "category": quiz.category,
            "status": quiz.status.value,
            "author": {"id": str(quiz.author_user_id), "display_name": author_name},
            "play_count": int(play_count),
            "created_at": quiz.created_at.isoformat() if quiz.created_at else None,
        }
        for quiz, author_name, play_count in rows
    ]

    return jsonify({"items": items, "pagination": _serialize_pagination(page, per_page, total)})


@admin_bp.get("/email-settings")
@admin_required
def get_email_settings():
    settings = EmailSettings.query.order_by(EmailSettings.id.asc()).first()
    if not settings:
        return jsonify(
            {
                "email_settings": {
                    "sender_name": "",
                    "sender_email": "",
                    "smtp_host": "",
                    "smtp_port": 587,
                    "smtp_username": "",
                    "use_tls": True,
                    "use_ssl": False,
                    "smtp_password_masked": "",
                    "has_smtp_password": False,
                },
                "meta": {
                    "permission": "rbac",
                    "password_policy": "smtp_password is accepted only on update and never returned as plain text.",
                },
            }
        )

    return jsonify(
        {
            "email_settings": {
                "sender_name": settings.sender_name,
                "sender_email": settings.sender_email,
                "smtp_host": settings.smtp_host,
                "smtp_port": settings.smtp_port,
                "smtp_username": settings.smtp_username,
                "use_tls": settings.use_tls,
                "use_ssl": settings.use_ssl,
                "smtp_password_masked": "********" if settings.smtp_password_encrypted else "",
                "has_smtp_password": bool(settings.smtp_password_encrypted),
                "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
            },
            "meta": {
                "permission": "rbac",
                "password_policy": "smtp_password is accepted only on update and never returned as plain text.",
            },
        }
    )


@admin_bp.put("/email-settings")
@admin_required
def put_email_settings():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _error_response("admin/validation_error", "JSON object is required.", 400)

    validation_error = _validate_email_settings_payload(payload)
    if validation_error:
        return _error_response("admin/validation_error", validation_error, 400)

    settings = EmailSettings.query.order_by(EmailSettings.id.asc()).first()
    if not settings:
        settings = EmailSettings(id=1)
        db.session.add(settings)

    settings.sender_name = payload["sender_name"].strip()
    settings.sender_email = payload["sender_email"].strip()
    settings.smtp_host = payload["smtp_host"].strip()
    settings.smtp_port = payload["smtp_port"]
    settings.smtp_username = payload["smtp_username"].strip()
    settings.use_tls = payload["use_tls"]
    settings.use_ssl = payload["use_ssl"]

    smtp_password = payload.get("smtp_password")
    if isinstance(smtp_password, str) and smtp_password.strip():
        settings.smtp_password = smtp_password

    db.session.commit()

    return jsonify(
        {
            "email_settings": {
                "sender_name": settings.sender_name,
                "sender_email": settings.sender_email,
                "smtp_host": settings.smtp_host,
                "smtp_port": settings.smtp_port,
                "smtp_username": settings.smtp_username,
                "use_tls": settings.use_tls,
                "use_ssl": settings.use_ssl,
                "smtp_password_masked": "********" if settings.smtp_password_encrypted else "",
                "has_smtp_password": bool(settings.smtp_password_encrypted),
                "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
            },
            "meta": {
                "password_updated": isinstance(smtp_password, str) and bool(smtp_password.strip()),
                "permission": "rbac",
            },
        }
    )
