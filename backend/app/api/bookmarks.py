from functools import wraps

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from ..authz import resolve_current_user
from ..extensions import db
from ..models import Question, Quiz, QuizStatus, User
from ..models_bookmarks import QuizBookmark


bookmarks_bp = Blueprint("bookmarks", __name__, url_prefix="/api/me/bookmarks")

DEFAULT_PAGE = 1
DEFAULT_PER_PAGE = 12
MAX_PER_PAGE = 50


def _error_response(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def bookmark_user_required(view):
    @wraps(view)
    @jwt_required()
    def wrapped(*args, **kwargs):
        user, error = resolve_current_user()
        if error:
            return error
        g.current_user = user
        return view(*args, **kwargs)

    return wrapped


def _parse_positive_int(value, field_name: str):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None, _error_response(
            "bookmark/validation_error",
            f"{field_name} must be an integer.",
            400,
        )
    if parsed < 1:
        return None, _error_response(
            "bookmark/validation_error",
            f"{field_name} must be 1 or greater.",
            400,
        )
    return parsed, None


def _validate_list_query(query_params):
    page, page_error = _parse_positive_int(query_params.get("page", DEFAULT_PAGE), "page")
    if page_error:
        return None, page_error

    per_page, per_page_error = _parse_positive_int(
        query_params.get("per_page", DEFAULT_PER_PAGE),
        "per_page",
    )
    if per_page_error:
        return None, per_page_error
    if per_page > MAX_PER_PAGE:
        return None, _error_response(
            "bookmark/validation_error",
            f"per_page must be between 1 and {MAX_PER_PAGE}.",
            400,
        )

    return {"page": page, "per_page": per_page}, None


def _description_summary(description: str | None, max_length: int = 160):
    if description is None:
        return None
    if len(description) <= max_length:
        return description
    return f"{description[: max_length - 1]}…"


def _published_quiz(quiz_id: int):
    return (
        db.session.query(Quiz)
        .filter(
            Quiz.id == quiz_id,
            Quiz.status == QuizStatus.published,
        )
        .first()
    )


def _serialize_bookmark(bookmark, quiz, author_display_name, question_count):
    return {
        "bookmarked_at": bookmark.created_at.isoformat() if bookmark.created_at else None,
        "quiz": {
            "id": str(quiz.id),
            "title": quiz.title,
            "description_summary": _description_summary(quiz.description),
            "category": quiz.category,
            "question_count": int(question_count or 0),
            "status": quiz.status.value,
            "author": {
                "id": str(quiz.author_user_id),
                "display_name": author_display_name,
            },
        },
    }


@bookmarks_bp.get("")
@bookmark_user_required
def list_bookmarks():
    validated, validation_error = _validate_list_query(request.args)
    if validation_error:
        return validation_error

    question_counts = (
        db.session.query(
            Question.quiz_id.label("quiz_id"),
            func.count(Question.id).label("question_count"),
        )
        .group_by(Question.quiz_id)
        .subquery()
    )

    base_query = (
        db.session.query(
            QuizBookmark,
            Quiz,
            User.display_name,
            func.coalesce(question_counts.c.question_count, 0).label("question_count"),
        )
        .join(Quiz, Quiz.id == QuizBookmark.quiz_id)
        .join(User, User.id == Quiz.author_user_id)
        .outerjoin(question_counts, question_counts.c.quiz_id == Quiz.id)
        .filter(
            QuizBookmark.user_id == g.current_user.id,
            Quiz.status == QuizStatus.published,
        )
    )

    total = int(
        db.session.query(func.count(QuizBookmark.quiz_id))
        .join(Quiz, Quiz.id == QuizBookmark.quiz_id)
        .filter(
            QuizBookmark.user_id == g.current_user.id,
            Quiz.status == QuizStatus.published,
        )
        .scalar()
        or 0
    )

    rows = (
        base_query.order_by(
            QuizBookmark.created_at.desc(),
            QuizBookmark.quiz_id.desc(),
        )
        .offset((validated["page"] - 1) * validated["per_page"])
        .limit(validated["per_page"])
        .all()
    )

    return jsonify(
        {
            "items": [
                _serialize_bookmark(bookmark, quiz, author_name, question_count)
                for bookmark, quiz, author_name, question_count in rows
            ],
            "pagination": {
                "page": validated["page"],
                "per_page": validated["per_page"],
                "total": total,
                "total_pages": (
                    (total + validated["per_page"] - 1) // validated["per_page"]
                    if total
                    else 0
                ),
            },
        }
    )


@bookmarks_bp.get("/<quiz_id>")
@bookmark_user_required
def get_bookmark_status(quiz_id):
    parsed_quiz_id, quiz_id_error = _parse_positive_int(quiz_id, "quiz_id")
    if quiz_id_error:
        return quiz_id_error

    if not _published_quiz(parsed_quiz_id):
        return _error_response(
            "bookmark/quiz_not_found",
            "Published quiz was not found.",
            404,
        )

    bookmark = db.session.get(
        QuizBookmark,
        (g.current_user.id, parsed_quiz_id),
    )
    return jsonify(
        {
            "quiz_id": str(parsed_quiz_id),
            "bookmarked": bookmark is not None,
        }
    )


@bookmarks_bp.put("/<quiz_id>")
@bookmark_user_required
def add_bookmark(quiz_id):
    parsed_quiz_id, quiz_id_error = _parse_positive_int(quiz_id, "quiz_id")
    if quiz_id_error:
        return quiz_id_error

    if not _published_quiz(parsed_quiz_id):
        return _error_response(
            "bookmark/quiz_not_found",
            "Published quiz was not found.",
            404,
        )

    existing = db.session.get(
        QuizBookmark,
        (g.current_user.id, parsed_quiz_id),
    )
    if existing:
        return jsonify(
            {
                "quiz_id": str(parsed_quiz_id),
                "bookmarked": True,
                "meta": {"changed": False},
            }
        )

    try:
        db.session.add(
            QuizBookmark(
                user_id=g.current_user.id,
                quiz_id=parsed_quiz_id,
            )
        )
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        concurrent = db.session.get(
            QuizBookmark,
            (g.current_user.id, parsed_quiz_id),
        )
        if concurrent:
            return jsonify(
                {
                    "quiz_id": str(parsed_quiz_id),
                    "bookmarked": True,
                    "meta": {"changed": False},
                }
            )
        return _error_response(
            "bookmark/save_failed",
            "Bookmark could not be saved.",
            500,
        )
    except SQLAlchemyError:
        db.session.rollback()
        return _error_response(
            "bookmark/save_failed",
            "Bookmark could not be saved.",
            500,
        )

    return (
        jsonify(
            {
                "quiz_id": str(parsed_quiz_id),
                "bookmarked": True,
                "meta": {"changed": True},
            }
        ),
        201,
    )


@bookmarks_bp.delete("/<quiz_id>")
@bookmark_user_required
def remove_bookmark(quiz_id):
    parsed_quiz_id, quiz_id_error = _parse_positive_int(quiz_id, "quiz_id")
    if quiz_id_error:
        return quiz_id_error

    bookmark = db.session.get(
        QuizBookmark,
        (g.current_user.id, parsed_quiz_id),
    )
    if not bookmark:
        return jsonify(
            {
                "quiz_id": str(parsed_quiz_id),
                "bookmarked": False,
                "meta": {"changed": False},
            }
        )

    try:
        db.session.delete(bookmark)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return _error_response(
            "bookmark/delete_failed",
            "Bookmark could not be removed.",
            500,
        )

    return jsonify(
        {
            "quiz_id": str(parsed_quiz_id),
            "bookmarked": False,
            "meta": {"changed": True},
        }
    )
