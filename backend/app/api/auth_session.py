import hmac

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
    set_access_cookies,
    set_refresh_cookies,
    unset_jwt_cookies,
)

from ..extensions import db
from ..models import User


auth_session_bp = Blueprint("auth_session", __name__, url_prefix="/api/auth")

_SESSION_ENDPOINTS = {
    "/api/auth/register": "password",
    "/api/auth/login": "password",
    "/api/auth/google": "google",
}
_SESSION_HINT_COOKIE = "quizverse_session_hint"


def _error_response(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def _serialize_user(user: User):
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "status": user.status.value,
    }


def _seconds(config_key: str) -> int:
    value = current_app.config[config_key]
    return max(1, int(value.total_seconds()))


def _set_session_hint(response) -> None:
    response.set_cookie(
        _SESSION_HINT_COOKIE,
        "1",
        max_age=_seconds("JWT_REFRESH_TOKEN_EXPIRES"),
        secure=bool(current_app.config["JWT_COOKIE_SECURE"]),
        httponly=False,
        samesite=current_app.config["JWT_COOKIE_SAMESITE"],
        domain=current_app.config.get("JWT_COOKIE_DOMAIN"),
        path="/",
    )


def _clear_session_hint(response) -> None:
    response.delete_cookie(
        _SESSION_HINT_COOKIE,
        secure=bool(current_app.config["JWT_COOKIE_SECURE"]),
        httponly=False,
        samesite=current_app.config["JWT_COOKIE_SAMESITE"],
        domain=current_app.config.get("JWT_COOKIE_DOMAIN"),
        path="/",
    )


def _set_auth_cookies(response, user_id: str, auth_method: str) -> None:
    claims = {"scope": "user", "auth_method": auth_method}
    access_token = create_access_token(
        identity=user_id,
        additional_claims=claims,
    )
    refresh_token = create_refresh_token(
        identity=user_id,
        additional_claims=claims,
    )
    set_access_cookies(
        response,
        access_token,
        max_age=_seconds("JWT_ACCESS_TOKEN_EXPIRES"),
    )
    set_refresh_cookies(
        response,
        refresh_token,
        max_age=_seconds("JWT_REFRESH_TOKEN_EXPIRES"),
    )
    _set_session_hint(response)


def _logout_csrf_is_valid() -> bool:
    """Allow idempotent cleanup without a session, otherwise require double submit.

    Logout intentionally does not require a valid JWT so an expired access
    token can still be removed. When a browser session hint exists, the caller
    must prove same-origin access by echoing either readable CSRF cookie.
    """
    if request.cookies.get(_SESSION_HINT_COOKIE) != "1":
        return True

    header_name = current_app.config["JWT_ACCESS_CSRF_HEADER_NAME"]
    provided = request.headers.get(header_name)
    if not provided:
        return False

    cookie_names = {
        current_app.config["JWT_ACCESS_CSRF_COOKIE_NAME"],
        current_app.config["JWT_REFRESH_CSRF_COOKIE_NAME"],
    }
    expected_values = [
        request.cookies.get(cookie_name)
        for cookie_name in cookie_names
        if request.cookies.get(cookie_name)
    ]
    return any(
        hmac.compare_digest(provided, expected)
        for expected in expected_values
    )


@auth_session_bp.after_app_request
def attach_cookie_session(response):
    """Convert successful browser login responses into cookie sessions.

    Existing auth routes continue to own validation and user creation. This
    layer issues a fresh access/refresh pair and removes JWT material from JSON
    outside tests or explicit compatibility mode.
    """
    auth_method = _SESSION_ENDPOINTS.get(request.path)
    if request.method != "POST" or not auth_method or not 200 <= response.status_code < 300:
        return response

    payload = response.get_json(silent=True)
    if not isinstance(payload, dict):
        return response

    user = payload.get("user")
    user_id = user.get("id") if isinstance(user, dict) else None
    if user_id is None:
        return response

    _set_auth_cookies(response, str(user_id), auth_method)

    expose_token = current_app.testing or current_app.config.get(
        "AUTH_EXPOSE_TOKEN_IN_RESPONSE", False
    )
    if not expose_token:
        payload.pop("access_token", None)
        payload.pop("refresh_token", None)
        payload["token_type"] = "Cookie"
        response.set_data(current_app.json.dumps(payload))
        response.content_type = "application/json"

    return response


@auth_session_bp.post("/refresh")
@jwt_required(refresh=True, locations=["cookies"])
def refresh_session():
    identity = get_jwt_identity()
    try:
        user_id = int(identity)
    except (TypeError, ValueError):
        return _error_response(
            "auth/invalid_identity",
            "Refresh token identity is invalid.",
            401,
        )

    user = db.session.get(User, user_id)
    if not user:
        return _error_response(
            "auth/user_not_found",
            "User associated with refresh token was not found.",
            401,
        )

    refresh_claims = get_jwt()
    access_token = create_access_token(
        identity=str(user.id),
        additional_claims={
            "scope": refresh_claims.get("scope", "user"),
            "auth_method": refresh_claims.get("auth_method", "refresh"),
        },
    )
    response = jsonify(
        {
            "status": "refreshed",
            "token_type": "Cookie",
            "user": _serialize_user(user),
        }
    )
    set_access_cookies(
        response,
        access_token,
        max_age=_seconds("JWT_ACCESS_TOKEN_EXPIRES"),
    )
    _set_session_hint(response)
    return response, 200


@auth_session_bp.post("/logout")
def logout_session():
    if not _logout_csrf_is_valid():
        return _error_response(
            "auth/csrf_failed",
            "CSRF token is missing or invalid.",
            401,
        )

    response = jsonify({"status": "logged_out"})
    unset_jwt_cookies(response)
    _clear_session_hint(response)
    return response, 200
