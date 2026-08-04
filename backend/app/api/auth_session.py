import hmac
from urllib.parse import urlsplit

from flask import Blueprint, current_app, jsonify, make_response, request
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
from sqlalchemy import func

from ..extensions import db, jwt
from ..models import User, UserStatus


auth_session_bp = Blueprint("auth_session", __name__, url_prefix="/api/auth")

_SESSION_ENDPOINTS = {
    "/api/auth/register": "password",
    "/api/auth/login": "password",
    "/api/auth/google": "google",
}
_OTP_ENDPOINTS = {"/api/auth/otp/request", "/api/auth/otp/verify"}
_SESSION_HINT_COOKIE = "quizverse_session_hint"


def _error_response(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def _error_http_response(code: str, message: str, status_code: int):
    return make_response(
        jsonify({"error": {"code": code, "message": message}}),
        status_code,
    )


def _inactive_account_response():
    return _error_response(
        "auth/account_inactive",
        "This account is not active.",
        403,
    )


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


def _normalize_origin(value: str | None) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _request_origin() -> tuple[str | None, bool]:
    origin_header = request.headers.get("Origin")
    if origin_header is not None:
        return _normalize_origin(origin_header), True

    referer_header = request.headers.get("Referer")
    if referer_header is not None:
        return _normalize_origin(referer_header), True

    return None, False


def _request_host_origin() -> str | None:
    forwarded_proto = request.headers.get("X-Forwarded-Proto", "").split(",", 1)[0].strip()
    forwarded_host = request.headers.get("X-Forwarded-Host", "").split(",", 1)[0].strip()
    scheme = forwarded_proto or request.scheme
    host = forwarded_host or request.host
    return _normalize_origin(f"{scheme}://{host}")


def _trusted_browser_origins() -> set[str]:
    configured = current_app.config.get("AUTH_TRUSTED_ORIGINS", [])
    origins = {
        normalized
        for value in configured
        if (normalized := _normalize_origin(value)) is not None
    }
    current_origin = _request_host_origin()
    if current_origin:
        origins.add(current_origin)
    return origins


def _browser_origin_status() -> bool | None:
    """Return True/False for browser requests and None for non-browser clients."""
    supplied_origin, header_present = _request_origin()
    if not header_present:
        return None
    if supplied_origin is None:
        return False
    return supplied_origin in _trusted_browser_origins()


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
    """Require double-submit proof whenever any browser session cookie exists."""
    cookie_names = {
        _SESSION_HINT_COOKIE,
        current_app.config["JWT_ACCESS_COOKIE_NAME"],
        current_app.config["JWT_ACCESS_CSRF_COOKIE_NAME"],
        current_app.config["JWT_REFRESH_CSRF_COOKIE_NAME"],
    }
    session_cookie_exists = any(request.cookies.get(name) for name in cookie_names)
    if not session_cookie_exists:
        return True

    header_name = current_app.config["JWT_ACCESS_CSRF_HEADER_NAME"]
    provided = request.headers.get(header_name)
    if not provided:
        return False

    expected_values = [
        request.cookies.get(current_app.config["JWT_ACCESS_CSRF_COOKIE_NAME"]),
        request.cookies.get(current_app.config["JWT_REFRESH_CSRF_COOKIE_NAME"]),
    ]
    return any(
        expected and hmac.compare_digest(provided, expected)
        for expected in expected_values
    )


def _user_from_identity(identity):
    try:
        user_id = int(identity)
    except (TypeError, ValueError):
        return None, False
    return db.session.get(User, user_id), True


@jwt.token_verification_loader
def verify_active_user_token(_jwt_header, jwt_payload):
    user, is_user_identity = _user_from_identity(jwt_payload.get("sub"))
    if not is_user_identity:
        return True
    return bool(user and user.status == UserStatus.active)


@jwt.token_verification_failed_loader
def handle_inactive_user_token(_jwt_header, jwt_payload):
    user, is_user_identity = _user_from_identity(jwt_payload.get("sub"))
    if is_user_identity and user and user.status != UserStatus.active:
        return _inactive_account_response()
    return _error_response(
        "auth/user_not_found",
        "User associated with token was not found.",
        401,
    )


@auth_session_bp.before_app_request
def reject_inactive_otp_account():
    if request.method != "POST" or request.path not in _OTP_ENDPOINTS:
        return None

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return None
    destination = payload.get("destination")
    if not isinstance(destination, str) or not destination.strip():
        return None

    user = User.query.filter(func.lower(User.email) == destination.strip().lower()).first()
    if user and user.status != UserStatus.active:
        return _inactive_account_response()
    return None


@auth_session_bp.after_app_request
def attach_cookie_session(response):
    """Convert successful same-origin browser logins into cookie sessions.

    Requests without Origin/Referer are treated as non-browser API clients and
    retain the existing bearer response. Browser requests with an untrusted
    origin are rejected before any authentication cookies are installed.
    """
    auth_method = _SESSION_ENDPOINTS.get(request.path)
    if request.method != "POST" or not auth_method or not 200 <= response.status_code < 300:
        return response

    payload = response.get_json(silent=True)
    if not isinstance(payload, dict):
        return response

    serialized_user = payload.get("user")
    user_id = serialized_user.get("id") if isinstance(serialized_user, dict) else None
    user, is_user_identity = _user_from_identity(user_id)
    if is_user_identity and user and user.status != UserStatus.active:
        return _error_http_response(
            "auth/account_inactive",
            "This account is not active.",
            403,
        )

    origin_status = _browser_origin_status()
    if origin_status is False:
        return _error_http_response(
            "auth/untrusted_origin",
            "Authentication request origin is not allowed.",
            403,
        )
    if origin_status is None:
        return response
    if not user:
        return response

    _set_auth_cookies(response, str(user.id), auth_method)

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
    if _browser_origin_status() is False:
        return _error_response(
            "auth/untrusted_origin",
            "Authentication request origin is not allowed.",
            403,
        )

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
    if _browser_origin_status() is False:
        return _error_response(
            "auth/untrusted_origin",
            "Authentication request origin is not allowed.",
            403,
        )

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