from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import func, or_
from sqlalchemy.exc import SQLAlchemyError

from ..authz import admin_required
from ..extensions import db
from ..models import AuditAction, AuditLog, User, UserRole, UserStatus

admin_user_management_bp = Blueprint(
    "admin_user_management",
    __name__,
    url_prefix="/api/admin/users",
)

DEFAULT_PAGE = 1
DEFAULT_PER_PAGE = 20
MAX_PER_PAGE = 50
MAX_SEARCH_LENGTH = 100
# "QV_ADMIN" encoded as a signed-64-bit-safe integer. PostgreSQL transaction
# advisory locks with this shared key serialize every role/status mutation that
# can change the active-admin count.
_ADMIN_MUTATION_LOCK_KEY = 0x51565F41444D494E


def _error_response(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def _parse_positive_int(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _validate_list_query(query_params):
    page = _parse_positive_int(query_params.get("page", DEFAULT_PAGE))
    per_page = _parse_positive_int(query_params.get("per_page", DEFAULT_PER_PAGE))
    if page is None:
        return None, _error_response("admin/validation_error", "page must be 1 or greater.", 400)
    if per_page is None or per_page > MAX_PER_PAGE:
        return None, _error_response(
            "admin/validation_error",
            f"per_page must be between 1 and {MAX_PER_PAGE}.",
            400,
        )

    query_text = str(query_params.get("q", "")).strip()
    if len(query_text) > MAX_SEARCH_LENGTH:
        return None, _error_response(
            "admin/validation_error",
            f"q must be {MAX_SEARCH_LENGTH} characters or fewer.",
            400,
        )

    role = str(query_params.get("role", "")).strip()
    if role and role not in {item.value for item in UserRole}:
        return None, _error_response(
            "admin/validation_error",
            "role must be one of: user, admin.",
            400,
        )

    status = str(query_params.get("status", "")).strip()
    if status and status not in {item.value for item in UserStatus}:
        return None, _error_response(
            "admin/validation_error",
            "status must be one of: active, suspended, withdrawn.",
            400,
        )

    return {
        "page": page,
        "per_page": per_page,
        "q": query_text,
        "role": role,
        "status": status,
    }, None


def _pagination(page: int, per_page: int, total: int):
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": (total + per_page - 1) // per_page if total else 0,
    }


def _mask_email(email: str):
    local, separator, domain = email.partition("@")
    if not separator or not local or not domain:
        return "***"
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}***@{domain}"


def _serialize_user(user: User):
    return {
        "id": str(user.id),
        "display_name": user.display_name,
        "email_masked": _mask_email(user.email),
        "role": user.role.value,
        "status": user.status.value,
        "is_self": user.id == g.current_user.id,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def _serialize_admin_mutation():
    """Serialize role/status mutations before target-row or count checks.

    PostgreSQL's transaction advisory lock is held until commit/rollback. All
    endpoints that can reduce active-admin membership acquire the same lock,
    preventing two concurrent transactions from both observing a stale count.
    SQLite is used only by tests and serializes writes at the database level.
    """
    bind = db.session.get_bind()
    if bind.dialect.name == "postgresql":
        db.session.execute(
            db.text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": _ADMIN_MUTATION_LOCK_KEY},
        )


def _active_admin_count():
    return int(
        db.session.query(func.count(User.id))
        .filter(User.role == UserRole.admin, User.status == UserStatus.active)
        .scalar()
        or 0
    )


def _audit_log_id_for_current_dialect():
    """Let PostgreSQL use audit_logs' BIGSERIAL sequence.

    The in-memory SQLite test schema declares this legacy key as BIGINT, which
    is not SQLite's implicit INTEGER ROWID alias. Supply a compatibility ID only
    for SQLite; production PostgreSQL omits the ID and allocates it atomically.
    """
    if db.session.get_bind().dialect.name != "sqlite":
        return None
    max_id = db.session.query(func.max(AuditLog.id)).scalar()
    return int(max_id or 0) + 1


def _append_audit_log(target: User, field: str, before: str, after: str):
    db.session.add(
        AuditLog(
            id=_audit_log_id_for_current_dialect(),
            actor_user_id=g.current_user.id,
            action=AuditAction.update,
            entity_type="user",
            entity_id=str(target.id),
            metadata_json={
                "field": field,
                "before": before,
                "after": after,
                "actor_role": g.current_user.role.value,
            },
        )
    )


def _load_target(user_id, *, lock=False):
    parsed_user_id = _parse_positive_int(user_id)
    if parsed_user_id is None:
        return None, _error_response(
            "admin/validation_error",
            "user_id must be a positive integer.",
            400,
        )

    user = db.session.get(User, parsed_user_id, with_for_update=lock)
    if not user:
        return None, _error_response("admin/user_not_found", "User was not found.", 404)
    return user, None


@admin_required
def get_admin_users_view():
    validated, validation_error = _validate_list_query(request.args)
    if validation_error:
        return validation_error

    query = User.query
    if validated["q"]:
        pattern = f"%{validated['q'].lower()}%"
        query = query.filter(
            or_(
                func.lower(User.email).like(pattern),
                func.lower(User.display_name).like(pattern),
            )
        )
    if validated["role"]:
        query = query.filter(User.role == UserRole(validated["role"]))
    if validated["status"]:
        query = query.filter(User.status == UserStatus(validated["status"]))

    total = int(query.with_entities(func.count(User.id)).scalar() or 0)
    users = (
        query.order_by(User.created_at.desc(), User.id.desc())
        .offset((validated["page"] - 1) * validated["per_page"])
        .limit(validated["per_page"])
        .all()
    )
    return jsonify(
        {
            "items": [_serialize_user(user) for user in users],
            "pagination": _pagination(
                validated["page"],
                validated["per_page"],
                total,
            ),
            "filters": {
                "q": validated["q"],
                "role": validated["role"],
                "status": validated["status"],
            },
        }
    )


def install_admin_user_list_view(app):
    """Replace the ISSUE-0038 read-only handler without duplicating its URL rule."""
    app.view_functions["admin.get_admin_users"] = get_admin_users_view


@admin_user_management_bp.get("/<user_id>")
@admin_required
def get_admin_user(user_id):
    user, error = _load_target(user_id)
    if error:
        return error
    return jsonify(
        {
            "user": _serialize_user(user),
            "protections": {
                "self_role_change_forbidden": user.id == g.current_user.id,
                "self_status_change_forbidden": user.id == g.current_user.id,
                "last_active_admin_guard": True,
            },
        }
    )


@admin_user_management_bp.patch("/<user_id>/role")
@admin_required
def patch_admin_user_role(user_id):
    payload = request.get_json(silent=True)
    role = payload.get("role") if isinstance(payload, dict) else None
    if role not in {item.value for item in UserRole}:
        return _error_response(
            "admin/validation_error",
            "role must be one of: user, admin.",
            400,
        )

    try:
        _serialize_admin_mutation()
        target, error = _load_target(user_id, lock=True)
        if error:
            db.session.rollback()
            return error

        next_role = UserRole(role)
        if target.id == g.current_user.id and next_role != UserRole.admin:
            db.session.rollback()
            return _error_response(
                "admin/self_role_change_forbidden",
                "You cannot remove your own admin role.",
                409,
            )

        if (
            target.role == UserRole.admin
            and target.status == UserStatus.active
            and next_role != UserRole.admin
            and _active_admin_count() <= 1
        ):
            db.session.rollback()
            return _error_response(
                "admin/last_active_admin",
                "The last active admin cannot be demoted.",
                409,
            )

        before = target.role.value
        if target.role == next_role:
            db.session.rollback()
            return jsonify({"user": _serialize_user(target), "meta": {"changed": False}})

        target.role = next_role
        _append_audit_log(target, "role", before, next_role.value)
        db.session.commit()
        return jsonify({"user": _serialize_user(target), "meta": {"changed": True}})
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception("Failed to update user role")
        return _error_response("admin/update_failed", "User role could not be updated.", 500)


@admin_user_management_bp.patch("/<user_id>/status")
@admin_required
def patch_admin_user_status(user_id):
    payload = request.get_json(silent=True)
    status = payload.get("status") if isinstance(payload, dict) else None
    if status not in {item.value for item in UserStatus}:
        return _error_response(
            "admin/validation_error",
            "status must be one of: active, suspended, withdrawn.",
            400,
        )

    try:
        _serialize_admin_mutation()
        target, error = _load_target(user_id, lock=True)
        if error:
            db.session.rollback()
            return error

        next_status = UserStatus(status)
        if target.id == g.current_user.id and next_status != UserStatus.active:
            db.session.rollback()
            return _error_response(
                "admin/self_status_change_forbidden",
                "You cannot deactivate your own account.",
                409,
            )

        if (
            target.role == UserRole.admin
            and target.status == UserStatus.active
            and next_status != UserStatus.active
            and _active_admin_count() <= 1
        ):
            db.session.rollback()
            return _error_response(
                "admin/last_active_admin",
                "The last active admin cannot be deactivated.",
                409,
            )

        before = target.status.value
        if target.status == next_status:
            db.session.rollback()
            return jsonify({"user": _serialize_user(target), "meta": {"changed": False}})

        target.status = next_status
        _append_audit_log(target, "status", before, next_status.value)
        db.session.commit()
        return jsonify({"user": _serialize_user(target), "meta": {"changed": True}})
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception("Failed to update user status")
        return _error_response("admin/update_failed", "User status could not be updated.", 500)