import re
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

from ..extensions import db, jwt
from ..models import OauthProvider, OtpChannel, OtpPurpose, OtpVerification, User, UserOauthAccount

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8
OTP_CODE_LENGTH = 6


class OtpDeliveryService:
    def send(self, channel: str, destination: str, code: str, purpose: str) -> None:
        if channel == "email":
            current_app.logger.info(
                "[OTP][EMAIL] purpose=%s destination=%s code=%s",
                purpose,
                destination,
                code,
            )
            return
        raise NotImplementedError(f"channel '{channel}' is not implemented")


otp_delivery_service = OtpDeliveryService()


def _error_response(code: str, message: str, status_code: int, detail: str | None = None):
    error = {"code": code, "message": message}
    if detail:
        error["detail"] = detail
    return jsonify({"error": error}), status_code


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_destination(channel: str, destination: str) -> str:
    if channel == "email":
        return _normalize_email(destination)
    return destination.strip()


def _next_user_id() -> int:
    max_id = db.session.query(func.max(User.id)).scalar()
    return int(max_id or 0) + 1


def _next_user_oauth_account_id() -> int:
    max_id = db.session.query(func.max(UserOauthAccount.id)).scalar()
    return int(max_id or 0) + 1


def _next_otp_verification_id() -> int:
    max_id = db.session.query(func.max(OtpVerification.id)).scalar()
    return int(max_id or 0) + 1


def _serialize_user(user: User):
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "status": user.status.value,
    }


def _validate_register_payload(payload: dict):
    email = payload.get("email")
    password = payload.get("password")
    display_name = payload.get("display_name")

    if not isinstance(email, str) or not EMAIL_REGEX.match(email.strip()):
        return None, None, None, _error_response(
            "auth/validation_error",
            "email is required and must be a valid email address.",
            400,
        )

    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        return None, None, None, _error_response(
            "auth/validation_error",
            f"password is required and must be at least {MIN_PASSWORD_LENGTH} characters.",
            400,
        )

    normalized_display_name = (
        display_name.strip() if isinstance(display_name, str) and display_name.strip() else email.split("@")[0]
    )
    if len(normalized_display_name) > 80:
        return None, None, None, _error_response(
            "auth/validation_error",
            "display_name must be 80 characters or fewer.",
            400,
        )

    return _normalize_email(email), password, normalized_display_name, None


def _validate_otp_payload(payload: dict):
    channel = payload.get("channel")
    purpose = payload.get("purpose")
    destination = payload.get("destination")

    if not isinstance(channel, str) or channel not in {"email", "phone"}:
        return None, None, None, _error_response(
            "auth/validation_error",
            "channel is required and must be one of: email, phone.",
            400,
        )

    if channel == "phone":
        return None, None, None, _error_response(
            "auth/otp_channel_not_implemented",
            "phone channel is planned but not implemented in this MVP.",
            501,
        )

    if not isinstance(purpose, str) or purpose not in {item.value for item in OtpPurpose}:
        return None, None, None, _error_response(
            "auth/validation_error",
            "purpose is required and must be one of: login, signup, password_reset.",
            400,
        )

    if not isinstance(destination, str) or not EMAIL_REGEX.match(destination.strip()):
        return None, None, None, _error_response(
            "auth/validation_error",
            "destination is required and must be a valid email address for channel=email.",
            400,
        )

    normalized_destination = _normalize_destination(channel, destination)
    return channel, purpose, normalized_destination, None


def _verify_google_id_token(raw_id_token: str, client_id: str):
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2 import id_token as google_id_token

    return google_id_token.verify_oauth2_token(
        raw_id_token,
        GoogleRequest(),
        client_id,
    )


def _generate_otp_code() -> str:
    return f"{secrets.randbelow(10**OTP_CODE_LENGTH):0{OTP_CODE_LENGTH}d}"


def _mark_active_otp_as_consumed(channel: str, purpose: str, destination: str) -> None:
    active_otps = OtpVerification.query.filter(
        OtpVerification.channel == OtpChannel(channel),
        OtpVerification.purpose == OtpPurpose(purpose),
        OtpVerification.destination == destination,
        OtpVerification.consumed_at.is_(None),
    ).all()
    if not active_otps:
        return

    now = datetime.now(timezone.utc)
    for otp in active_otps:
        otp.consumed_at = now


def _enforce_otp_request_rate_limit(channel: str, purpose: str, destination: str):
    now = datetime.now(timezone.utc)
    min_resend_seconds = current_app.config["OTP_MIN_RESEND_SECONDS"]
    max_per_hour = current_app.config["OTP_MAX_REQUESTS_PER_HOUR"]

    latest_request = (
        OtpVerification.query.filter(
            OtpVerification.channel == OtpChannel(channel),
            OtpVerification.purpose == OtpPurpose(purpose),
            OtpVerification.destination == destination,
        )
        .order_by(OtpVerification.created_at.desc())
        .first()
    )

    if latest_request and latest_request.created_at:
        since_latest = (now - latest_request.created_at.replace(tzinfo=timezone.utc)).total_seconds()
        if since_latest < min_resend_seconds:
            retry_after_seconds = int(min_resend_seconds - since_latest) + 1
            return _error_response(
                "auth/otp_rate_limited",
                "OTP request is rate limited. Please retry later.",
                429,
                detail=f"retry_after_seconds={retry_after_seconds}",
            )

    one_hour_ago = now - timedelta(hours=1)
    requests_last_hour = OtpVerification.query.filter(
        OtpVerification.channel == OtpChannel(channel),
        OtpVerification.purpose == OtpPurpose(purpose),
        OtpVerification.destination == destination,
        OtpVerification.created_at >= one_hour_ago,
    ).count()
    if requests_last_hour >= max_per_hour:
        return _error_response(
            "auth/otp_rate_limited",
            "OTP request limit reached for this destination.",
            429,
            detail="retry_after_seconds=3600",
        )

    return None


@auth_bp.post("/register")
def register():
    payload = request.get_json(silent=True) or {}
    email, password, display_name, validation_error = _validate_register_payload(payload)
    if validation_error:
        return validation_error

    existing_user = User.query.filter(func.lower(User.email) == email).first()
    if existing_user:
        return _error_response(
            "auth/email_already_registered",
            "The email address is already registered.",
            409,
        )

    user = User(id=_next_user_id(), email=email, display_name=display_name)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    access_token = create_access_token(
        identity=str(user.id),
        additional_claims={"scope": "user", "auth_method": "password"},
    )

    return (
        jsonify(
            {
                "access_token": access_token,
                "token_type": "Bearer",
                "user": _serialize_user(user),
            }
        ),
        201,
    )


@auth_bp.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = payload.get("email")
    password = payload.get("password")

    if not isinstance(email, str) or not isinstance(password, str):
        return _error_response(
            "auth/validation_error",
            "email and password are required.",
            400,
        )

    normalized_email = _normalize_email(email)
    user = User.query.filter(func.lower(User.email) == normalized_email).first()
    if not user or not user.check_password(password):
        return _error_response(
            "auth/invalid_credentials",
            "Invalid email or password.",
            401,
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.session.commit()

    access_token = create_access_token(
        identity=str(user.id),
        additional_claims={"scope": "user", "auth_method": "password"},
    )

    return (
        jsonify(
            {
                "access_token": access_token,
                "token_type": "Bearer",
                "user": _serialize_user(user),
            }
        ),
        200,
    )


@auth_bp.post("/otp/request")
def request_otp():
    payload = request.get_json(silent=True) or {}
    channel, purpose, destination, validation_error = _validate_otp_payload(payload)
    if validation_error:
        return validation_error

    rate_limit_error = _enforce_otp_request_rate_limit(channel, purpose, destination)
    if rate_limit_error:
        return rate_limit_error

    code = _generate_otp_code()
    otp_hash = generate_password_hash(code)
    expires_in_seconds = int(current_app.config["OTP_EXPIRES_SECONDS"])
    now = datetime.now(timezone.utc)

    _mark_active_otp_as_consumed(channel, purpose, destination)

    user = User.query.filter(func.lower(User.email) == destination).first()
    otp = OtpVerification(
        id=_next_otp_verification_id(),
        user_id=user.id if user else None,
        channel=OtpChannel(channel),
        purpose=OtpPurpose(purpose),
        destination=destination,
        otp_hash=otp_hash,
        expires_at=now + timedelta(seconds=expires_in_seconds),
        consumed_at=None,
        attempt_count=0,
    )
    db.session.add(otp)

    try:
        otp_delivery_service.send(channel=channel, destination=destination, code=code, purpose=purpose)
    except NotImplementedError as exc:
        db.session.rollback()
        return _error_response(
            "auth/otp_channel_not_implemented",
            "requested OTP channel is not implemented.",
            501,
            detail=str(exc),
        )

    db.session.commit()

    response = {
        "status": "otp_sent",
        "channel": channel,
        "purpose": purpose,
        "destination": destination,
        "expires_in_seconds": expires_in_seconds,
    }
    if current_app.config.get("OTP_INCLUDE_CODE_IN_RESPONSE", False):
        response["otp_code"] = code

    return jsonify(response), 202


@auth_bp.post("/otp/verify")
def verify_otp():
    payload = request.get_json(silent=True) or {}
    channel, purpose, destination, validation_error = _validate_otp_payload(payload)
    if validation_error:
        return validation_error

    code = payload.get("code")
    if not isinstance(code, str) or not code.strip() or not code.strip().isdigit() or len(code.strip()) != OTP_CODE_LENGTH:
        return _error_response(
            "auth/validation_error",
            f"code is required and must be a {OTP_CODE_LENGTH}-digit string.",
            400,
        )

    otp = (
        OtpVerification.query.filter(
            OtpVerification.channel == OtpChannel(channel),
            OtpVerification.purpose == OtpPurpose(purpose),
            OtpVerification.destination == destination,
            OtpVerification.consumed_at.is_(None),
        )
        .order_by(OtpVerification.created_at.desc())
        .first()
    )

    if not otp:
        return _error_response(
            "auth/otp_not_found",
            "No active OTP was found for this destination.",
            401,
        )

    now = datetime.now(timezone.utc)
    if otp.expires_at.replace(tzinfo=timezone.utc) < now:
        return _error_response(
            "auth/otp_expired",
            "OTP code has expired.",
            401,
        )

    max_attempts = int(current_app.config["OTP_MAX_VERIFY_ATTEMPTS"])
    if otp.attempt_count >= max_attempts:
        return _error_response(
            "auth/otp_attempt_limit_exceeded",
            "OTP verification attempt limit exceeded.",
            429,
        )

    input_code = code.strip()
    if not check_password_hash(otp.otp_hash, input_code):
        otp.attempt_count += 1
        db.session.commit()
        return _error_response(
            "auth/invalid_otp_code",
            "OTP code is invalid.",
            401,
        )

    otp.consumed_at = now
    db.session.commit()
    return jsonify({"status": "verified", "channel": channel, "purpose": purpose, "destination": destination}), 200


@auth_bp.post("/google")
def google_login():
    payload = request.get_json(silent=True) or {}
    raw_id_token = payload.get("id_token")
    if not isinstance(raw_id_token, str) or not raw_id_token.strip():
        return _error_response(
            "auth/validation_error",
            "id_token is required.",
            400,
        )

    client_id = current_app.config.get("GOOGLE_OAUTH_CLIENT_ID")
    if not client_id:
        return _error_response(
            "auth/google_oauth_not_configured",
            "Google OAuth client id is not configured.",
            500,
        )

    try:
        claims = _verify_google_id_token(raw_id_token, client_id)
    except ModuleNotFoundError:
        return _error_response(
            "auth/google_oauth_unavailable",
            "Google OAuth dependency is unavailable.",
            500,
        )
    except ValueError as exc:
        return _error_response(
            "auth/invalid_google_token",
            "Google token verification failed.",
            401,
            detail=str(exc),
        )

    issuer = claims.get("iss")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        return _error_response(
            "auth/invalid_google_token",
            "Google token issuer is invalid.",
            401,
        )

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        return _error_response(
            "auth/invalid_google_token",
            "Google token subject is missing.",
            401,
        )

    email = claims.get("email")
    if not isinstance(email, str) or not EMAIL_REGEX.match(email.strip()):
        return _error_response(
            "auth/google_email_required",
            "Google account email is required.",
            400,
        )

    if claims.get("email_verified") is False:
        return _error_response(
            "auth/google_email_not_verified",
            "Google account email is not verified.",
            401,
        )

    normalized_email = _normalize_email(email)

    oauth_account = UserOauthAccount.query.filter_by(
        provider=OauthProvider.google,
        provider_user_id=subject,
    ).first()
    if oauth_account:
        user = oauth_account.user
        oauth_account.provider_email = normalized_email
    else:
        user = User.query.filter(func.lower(User.email) == normalized_email).first()
        if not user:
            display_name = claims.get("name")
            normalized_display_name = (
                display_name.strip()
                if isinstance(display_name, str) and display_name.strip()
                else normalized_email.split("@")[0]
            )
            user = User(
                id=_next_user_id(),
                email=normalized_email,
                display_name=normalized_display_name[:80],
                avatar_url=claims.get("picture") if isinstance(claims.get("picture"), str) else None,
            )
            db.session.add(user)

        oauth_account = UserOauthAccount(
            id=_next_user_oauth_account_id(),
            user=user,
            provider=OauthProvider.google,
            provider_user_id=subject,
            provider_email=normalized_email,
        )
        db.session.add(oauth_account)

    user.last_login_at = datetime.now(timezone.utc)
    db.session.commit()

    access_token = create_access_token(
        identity=str(user.id),
        additional_claims={"scope": "user", "auth_method": "google"},
    )

    return (
        jsonify(
            {
                "access_token": access_token,
                "token_type": "Bearer",
                "user": _serialize_user(user),
            }
        ),
        200,
    )


@auth_bp.post("/dev-token")
def issue_dev_token():
    if not current_app.config.get("AUTH_ENABLE_DEV_TOKEN_ENDPOINT", False):
        return _error_response(
            "auth/dev_token_disabled",
            "Development token endpoint is disabled.",
            403,
        )

    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("user_id", "dev-user-1"))

    token = create_access_token(
        identity=user_id,
        additional_claims={"scope": "dev", "auth_method": "dev-token"},
    )

    return (
        jsonify(
            {
                "access_token": token,
                "token_type": "Bearer",
                "identity": user_id,
                "note": "Development-only endpoint. Disable in production with AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false.",
            }
        ),
        200,
    )


@auth_bp.get("/protected")
@jwt_required()
def protected():
    identity = get_jwt_identity()
    claims = get_jwt()
    return (
        jsonify(
            {
                "message": "You are authenticated",
                "identity": identity,
                "claims": claims,
            }
        ),
        200,
    )


@auth_bp.get("/me")
@jwt_required()
def me():
    identity = get_jwt_identity()
    try:
        user_id = int(identity)
    except (TypeError, ValueError):
        return _error_response(
            "auth/invalid_identity",
            "Token identity is invalid.",
            401,
        )

    user = db.session.get(User, user_id)
    if not user:
        return _error_response(
            "auth/user_not_found",
            "User associated with token was not found.",
            404,
        )

    return jsonify({"user": _serialize_user(user)}), 200


@jwt.unauthorized_loader
def _handle_missing_token(reason: str):
    return _error_response(
        "auth/missing_token",
        "Authentication token is required.",
        401,
        detail=reason,
    )


@jwt.invalid_token_loader
def _handle_invalid_token(reason: str):
    return _error_response(
        "auth/invalid_token",
        "Authentication token is invalid.",
        401,
        detail=reason,
    )


@jwt.expired_token_loader
def _handle_expired_token(_jwt_header, _jwt_payload):
    return _error_response(
        "auth/token_expired",
        "Authentication token has expired.",
        401,
    )
