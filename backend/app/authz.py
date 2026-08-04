from functools import wraps

from flask import current_app, g, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func

from .extensions import db
from .models import OauthProvider, User, UserOauthAccount, UserRole, UserStatus


def _error_response(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def _has_verified_google_email(user: User) -> bool:
    # UserOauthAccount is created only after the Google ID token has passed the
    # issuer, audience and email_verified checks in /api/auth/google.
    account = (
        db.session.query(UserOauthAccount.id)
        .filter(
            UserOauthAccount.user_id == user.id,
            UserOauthAccount.provider == OauthProvider.google,
            func.lower(UserOauthAccount.provider_email) == user.email.lower(),
        )
        .first()
    )
    return account is not None


def _bootstrap_admin_if_configured(user: User) -> bool:
    configured = {
        value.strip().lower()
        for value in current_app.config.get("ADMIN_BOOTSTRAP_EMAILS", [])
        if isinstance(value, str) and value.strip()
    }
    if user.email.lower() not in configured or user.role == UserRole.admin:
        return False

    # A password-only registration does not prove ownership of the submitted
    # address. Require a verified Google OAuth link before using an email-based
    # bootstrap entry so an attacker cannot pre-register the configured email.
    if not _has_verified_google_email(user):
        return False

    user.role = UserRole.admin
    db.session.commit()
    return True


def resolve_current_user():
    identity = get_jwt_identity()
    try:
        user_id = int(identity)
    except (TypeError, ValueError):
        return None, _error_response(
            "auth/invalid_identity",
            "Authenticated user identity is invalid.",
            401,
        )

    user = db.session.get(User, user_id)
    if not user:
        return None, _error_response(
            "auth/user_not_found",
            "Authenticated user was not found.",
            401,
        )

    if user.status != UserStatus.active:
        return None, _error_response(
            "auth/account_inactive",
            "This account is not active.",
            403,
        )

    _bootstrap_admin_if_configured(user)
    return user, None


def admin_required(view):
    @wraps(view)
    @jwt_required()
    def wrapped(*args, **kwargs):
        user, error = resolve_current_user()
        if error:
            return error
        if user.role != UserRole.admin:
            return _error_response(
                "admin/forbidden",
                "Admin role is required.",
                403,
            )

        g.current_user = user
        return view(*args, **kwargs)

    return wrapped
