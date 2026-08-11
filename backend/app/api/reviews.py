from functools import wraps

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from ..authz import resolve_current_user
from ..extensions import db
from ..models import PlayStatus, Quiz, QuizPlay, QuizStatus, User
from ..models_reviews import QuizReview


reviews_bp = Blueprint("reviews", __name__, url_prefix="/api/quizzes")

REVIEW_BODY_MAX_LENGTH = 1000
DEFAULT_PAGE = 1
DEFAULT_PER_PAGE = 10
MAX_PER_PAGE = 50


def _error_response(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def review_user_required(view):
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
            "review/validation_error",
            f"{field_name} must be an integer.",
            400,
        )
    if parsed < 1:
        return None, _error_response(
            "review/validation_error",
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
            "review/validation_error",
            f"per_page must be between 1 and {MAX_PER_PAGE}.",
            400,
        )

    return {"page": page, "per_page": per_page}, None


def _validate_review_payload(payload):
    if not isinstance(payload, dict):
        return None, _error_response(
            "review/validation_error",
            "request body must be an object.",
            400,
        )

    rating = payload.get("rating")
    if isinstance(rating, bool) or not isinstance(rating, int) or rating < 1 or rating > 5:
        return None, _error_response(
            "review/validation_error",
            "rating must be an integer between 1 and 5.",
            400,
        )

    body = payload.get("body")
    if body is not None and not isinstance(body, str):
        return None, _error_response(
            "review/validation_error",
            "body must be a string or null.",
            400,
        )
    normalized_body = body.strip() if isinstance(body, str) and body.strip() else None
    if normalized_body and len(normalized_body) > REVIEW_BODY_MAX_LENGTH:
        return None, _error_response(
            "review/validation_error",
            f"body must be {REVIEW_BODY_MAX_LENGTH} characters or fewer.",
            400,
        )

    return {"rating": rating, "body": normalized_body}, None


def _published_quiz(quiz_id: int):
    return (
        db.session.query(Quiz)
        .filter(
            Quiz.id == quiz_id,
            Quiz.status == QuizStatus.published,
        )
        .first()
    )


def _review_summary(quiz_id: int):
    average, count = (
        db.session.query(
            func.avg(QuizReview.rating),
            func.count(QuizReview.user_id),
        )
        .filter(QuizReview.quiz_id == quiz_id)
        .one()
    )
    return {
        "rating_average": round(float(average), 2) if average is not None else None,
        "review_count": int(count or 0),
    }


def _serialize_review(review: QuizReview, display_name: str | None):
    return {
        "rating": int(review.rating),
        "body": review.body,
        "created_at": review.created_at.isoformat() if review.created_at else None,
        "updated_at": review.updated_at.isoformat() if review.updated_at else None,
        "user": {
            "id": str(review.user_id),
            "display_name": display_name,
        },
    }


def _review_eligibility(user, quiz: Quiz):
    if quiz.author_user_id == user.id:
        return {"eligible": False, "reason": "author"}

    has_submitted_play = (
        db.session.query(QuizPlay.id)
        .filter(
            QuizPlay.quiz_id == quiz.id,
            QuizPlay.player_user_id == user.id,
            QuizPlay.status == PlayStatus.submitted,
        )
        .first()
        is not None
    )
    if not has_submitted_play:
        return {"eligible": False, "reason": "not_played"}
    return {"eligible": True, "reason": None}


@reviews_bp.get("/<quiz_id>/reviews")
def list_reviews(quiz_id):
    parsed_quiz_id, quiz_id_error = _parse_positive_int(quiz_id, "quiz_id")
    if quiz_id_error:
        return quiz_id_error

    quiz = _published_quiz(parsed_quiz_id)
    if not quiz:
        return _error_response("review/quiz_not_found", "Published quiz was not found.", 404)

    validated, validation_error = _validate_list_query(request.args)
    if validation_error:
        return validation_error

    total = int(
        db.session.query(func.count(QuizReview.user_id))
        .filter(QuizReview.quiz_id == parsed_quiz_id)
        .scalar()
        or 0
    )
    rows = (
        db.session.query(QuizReview, User.display_name)
        .join(User, User.id == QuizReview.user_id)
        .filter(QuizReview.quiz_id == parsed_quiz_id)
        .order_by(
            QuizReview.updated_at.desc(),
            QuizReview.user_id.desc(),
        )
        .offset((validated["page"] - 1) * validated["per_page"])
        .limit(validated["per_page"])
        .all()
    )

    return jsonify(
        {
            "quiz_id": str(parsed_quiz_id),
            "summary": _review_summary(parsed_quiz_id),
            "items": [
                _serialize_review(review, display_name)
                for review, display_name in rows
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


@reviews_bp.get("/<quiz_id>/reviews/me")
@review_user_required
def get_my_review(quiz_id):
    parsed_quiz_id, quiz_id_error = _parse_positive_int(quiz_id, "quiz_id")
    if quiz_id_error:
        return quiz_id_error

    quiz = _published_quiz(parsed_quiz_id)
    if not quiz:
        return _error_response("review/quiz_not_found", "Published quiz was not found.", 404)

    review = db.session.get(QuizReview, (g.current_user.id, parsed_quiz_id))
    return jsonify(
        {
            "quiz_id": str(parsed_quiz_id),
            "review": (
                _serialize_review(review, g.current_user.display_name)
                if review
                else None
            ),
            "eligibility": _review_eligibility(g.current_user, quiz),
        }
    )


@reviews_bp.put("/<quiz_id>/reviews/me")
@review_user_required
def upsert_my_review(quiz_id):
    parsed_quiz_id, quiz_id_error = _parse_positive_int(quiz_id, "quiz_id")
    if quiz_id_error:
        return quiz_id_error

    payload = request.get_json(silent=True)
    validated, validation_error = _validate_review_payload(payload)
    if validation_error:
        return validation_error

    quiz = _published_quiz(parsed_quiz_id)
    if not quiz:
        return _error_response("review/quiz_not_found", "Published quiz was not found.", 404)

    eligibility = _review_eligibility(g.current_user, quiz)
    if not eligibility["eligible"]:
        if eligibility["reason"] == "author":
            return _error_response(
                "review/author_not_allowed",
                "Quiz authors cannot review their own quiz.",
                403,
            )
        return _error_response(
            "review/play_required",
            "Submit this quiz at least once before reviewing it.",
            403,
        )

    review = db.session.get(QuizReview, (g.current_user.id, parsed_quiz_id))
    created = review is None
    if created:
        review = QuizReview(
            user_id=g.current_user.id,
            quiz_id=parsed_quiz_id,
            rating=validated["rating"],
            body=validated["body"],
        )
        db.session.add(review)
    else:
        review.rating = validated["rating"]
        review.body = validated["body"]

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        concurrent = db.session.get(QuizReview, (g.current_user.id, parsed_quiz_id))
        if concurrent is None:
            return _error_response("review/save_failed", "Review could not be saved.", 500)
        concurrent.rating = validated["rating"]
        concurrent.body = validated["body"]
        try:
            db.session.commit()
            review = concurrent
            created = False
        except SQLAlchemyError:
            db.session.rollback()
            return _error_response("review/save_failed", "Review could not be saved.", 500)
    except SQLAlchemyError:
        db.session.rollback()
        return _error_response("review/save_failed", "Review could not be saved.", 500)

    return (
        jsonify(
            {
                "quiz_id": str(parsed_quiz_id),
                "review": _serialize_review(review, g.current_user.display_name),
                "summary": _review_summary(parsed_quiz_id),
                "meta": {"created": created},
            }
        ),
        201 if created else 200,
    )


@reviews_bp.delete("/<quiz_id>/reviews/me")
@review_user_required
def delete_my_review(quiz_id):
    parsed_quiz_id, quiz_id_error = _parse_positive_int(quiz_id, "quiz_id")
    if quiz_id_error:
        return quiz_id_error

    review = db.session.get(QuizReview, (g.current_user.id, parsed_quiz_id))
    if not review:
        return jsonify(
            {
                "quiz_id": str(parsed_quiz_id),
                "review": None,
                "meta": {"changed": False},
            }
        )

    try:
        db.session.delete(review)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return _error_response("review/delete_failed", "Review could not be deleted.", 500)

    return jsonify(
        {
            "quiz_id": str(parsed_quiz_id),
            "review": None,
            "meta": {"changed": True},
        }
    )
