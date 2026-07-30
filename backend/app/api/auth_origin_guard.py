from flask import jsonify, request

from .auth import auth_bp
from .auth_session import _browser_origin_status


_COOKIE_SESSION_AUTH_PATHS = {
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/google",
}


@auth_bp.before_request
def reject_untrusted_browser_auth_origin():
    """Reject cross-origin browser auth before handlers mutate the database."""
    if request.method != "POST" or request.path not in _COOKIE_SESSION_AUTH_PATHS:
        return None

    if _browser_origin_status() is not False:
        return None

    return jsonify(
        {
            "error": {
                "code": "auth/untrusted_origin",
                "message": "Authentication request origin is not allowed.",
            }
        }
    ), 403
