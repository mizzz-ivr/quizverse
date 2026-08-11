import re

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func, or_

from ..extensions import db
from ..models import Question, Quiz, QuizStatus, User
from ..models_reviews import QuizReview
from .quizzes import (
    _serialize_quiz_list_item,
    _validate_list_query_params,
)


review_catalog_bp = Blueprint("review_catalog", __name__)

QUIZ_DETAIL_PATTERN = re.compile(r"^/api/quizzes/(?P<quiz_id>\d+)$")
ALLOWED_SORTS = {"latest", "rating"}
GET_LIKE_METHODS = {"GET", "HEAD"}


def _publication_enforced() -> bool:
    configured = current_app.config.get("QUIZ_PUBLICATION_ENFORCED")
    if configured is not None:
        return bool(configured)
    return not current_app.testing


def _sort_error():
    return (
        jsonify(
            {
                "error": {
                    "code": "quiz/validation_error",
                    "message": "sort must be one of latest, rating.",
                }
            }
        ),
        400,
    )


def _selected_sort():
    raw = request.args.get("sort", "latest")
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower()
    return value if value in ALLOWED_SORTS else None


def _question_counts_subquery():
    return (
        db.session.query(
            Question.quiz_id.label("quiz_id"),
            func.count(Question.id).label("question_count"),
        )
        .group_by(Question.quiz_id)
        .subquery()
    )


def _review_stats_subquery():
    return (
        db.session.query(
            QuizReview.quiz_id.label("quiz_id"),
            func.avg(QuizReview.rating).label("rating_average"),
            func.count(QuizReview.user_id).label("review_count"),
        )
        .group_by(QuizReview.quiz_id)
        .subquery()
    )


def _serialize_with_rating(quiz, display_name, question_count, rating_average, review_count):
    item = _serialize_quiz_list_item(quiz, display_name, question_count)
    item["rating_average"] = (
        round(float(rating_average), 2)
        if rating_average is not None and int(review_count or 0) > 0
        else None
    )
    item["review_count"] = int(review_count or 0)
    return item


def _rating_sorted_list_response():
    validated, validation_error = _validate_list_query_params(request.args)
    if validation_error:
        return validation_error

    page = validated["page"]
    per_page = validated["per_page"]
    offset = (page - 1) * per_page
    question_counts = _question_counts_subquery()
    review_stats = _review_stats_subquery()

    base_query = (
        db.session.query(
            Quiz,
            User.display_name,
            func.coalesce(question_counts.c.question_count, 0).label("question_count"),
            review_stats.c.rating_average,
            func.coalesce(review_stats.c.review_count, 0).label("review_count"),
        )
        .join(User, User.id == Quiz.author_user_id)
        .outerjoin(question_counts, question_counts.c.quiz_id == Quiz.id)
        .outerjoin(review_stats, review_stats.c.quiz_id == Quiz.id)
    )
    total_query = db.session.query(func.count(Quiz.id))

    if _publication_enforced():
        base_query = base_query.filter(Quiz.status == QuizStatus.published)
        total_query = total_query.filter(Quiz.status == QuizStatus.published)

    if validated["q"]:
        pattern = f"%{validated['q']}%"
        search_condition = or_(Quiz.title.ilike(pattern), Quiz.description.ilike(pattern))
        base_query = base_query.filter(search_condition)
        total_query = total_query.filter(search_condition)
    if validated["category"]:
        base_query = base_query.filter(Quiz.category == validated["category"])
        total_query = total_query.filter(Quiz.category == validated["category"])

    total_count = int(total_query.scalar() or 0)
    published_order = func.coalesce(Quiz.published_at, Quiz.created_at)
    rows = (
        base_query.order_by(
            func.coalesce(review_stats.c.rating_average, 0).desc(),
            func.coalesce(review_stats.c.review_count, 0).desc(),
            published_order.desc(),
            Quiz.id.desc(),
        )
        .offset(offset)
        .limit(per_page)
        .all()
    )

    return jsonify(
        {
            "items": [
                _serialize_with_rating(
                    quiz,
                    display_name,
                    question_count,
                    rating_average,
                    review_count,
                )
                for quiz, display_name, question_count, rating_average, review_count in rows
            ],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total_count,
                "total_pages": (total_count + per_page - 1) // per_page if total_count else 0,
            },
            "filters": {
                "q": validated["q"],
                "category": validated["category"],
                "sort": "rating",
            },
        }
    )


def _stats_for_quiz_ids(quiz_ids):
    if not quiz_ids:
        return {}
    rows = (
        db.session.query(
            QuizReview.quiz_id,
            func.avg(QuizReview.rating),
            func.count(QuizReview.user_id),
        )
        .filter(QuizReview.quiz_id.in_(quiz_ids))
        .group_by(QuizReview.quiz_id)
        .all()
    )
    return {
        int(quiz_id): {
            "rating_average": round(float(average), 2),
            "review_count": int(count or 0),
        }
        for quiz_id, average, count in rows
    }


def _inject_stats(item, stats):
    try:
        quiz_id = int(item.get("id"))
    except (TypeError, ValueError, AttributeError):
        return
    aggregate = stats.get(quiz_id)
    item["rating_average"] = aggregate["rating_average"] if aggregate else None
    item["review_count"] = aggregate["review_count"] if aggregate else 0


@review_catalog_bp.before_app_request
def validate_and_apply_quiz_sort():
    if request.method not in GET_LIKE_METHODS or request.path != "/api/quizzes":
        return None

    selected_sort = _selected_sort()
    if selected_sort is None:
        return _sort_error()
    if selected_sort == "rating":
        return _rating_sorted_list_response()
    return None


@review_catalog_bp.after_app_request
def enrich_quiz_catalog_response(response):
    if request.method not in GET_LIKE_METHODS or response.status_code >= 400 or not response.is_json:
        return response

    if request.path == "/api/quizzes":
        if _selected_sort() == "rating":
            return response
        payload = response.get_json(silent=True)
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            return response
        quiz_ids = []
        for item in payload["items"]:
            try:
                quiz_ids.append(int(item.get("id")))
            except (TypeError, ValueError, AttributeError):
                continue
        stats = _stats_for_quiz_ids(quiz_ids)
        for item in payload["items"]:
            _inject_stats(item, stats)
        payload.setdefault("filters", {})["sort"] = "latest"
        response.set_data(current_app.json.dumps(payload))
        return response

    detail_match = QUIZ_DETAIL_PATTERN.match(request.path)
    if detail_match:
        payload = response.get_json(silent=True)
        quiz = payload.get("quiz") if isinstance(payload, dict) else None
        if not isinstance(quiz, dict) or quiz.get("status") != QuizStatus.published.value:
            return response
        quiz_id = int(detail_match.group("quiz_id"))
        _inject_stats(quiz, _stats_for_quiz_ids([quiz_id]))
        response.set_data(current_app.json.dumps(payload))

    return response
