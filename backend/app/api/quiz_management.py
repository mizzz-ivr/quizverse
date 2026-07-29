import re
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request
from sqlalchemy import func, or_

from ..extensions import db
from ..models import Choice, PlayStatus, Question, Quiz, QuizPlay, QuizStatus, User
from .quizzes import (
    _description_summary,
    _error_response as quiz_error_response,
    _serialize_quiz_detail,
    _serialize_quiz_list_item,
    _validate_list_query_params,
)
from .rankings import (
    _masked_display_name,
    _serialize_pagination,
    _validate_pagination,
)

quiz_management_bp = Blueprint("quiz_management", __name__, url_prefix="/api")

QUIZ_DETAIL_PATTERN = re.compile(r"^/api/quizzes/(?P<quiz_id>\d+)$")
QUIZ_PLAY_PATTERN = re.compile(r"^/api/quizzes/(?P<quiz_id>\d+)/play$")
QUIZ_RANKING_PATTERN = re.compile(r"^/api/quizzes/(?P<quiz_id>\d+)/rankings$")
GET_LIKE_METHODS = {"GET", "HEAD"}
ALLOWED_STATUS_FILTERS = {"all", *(status.value for status in QuizStatus)}
ALLOWED_TRANSITIONS = {
    QuizStatus.draft: {QuizStatus.published, QuizStatus.archived},
    QuizStatus.published: {QuizStatus.archived},
    QuizStatus.archived: {QuizStatus.draft, QuizStatus.published},
}


def _publication_enforced() -> bool:
    configured = current_app.config.get("QUIZ_PUBLICATION_ENFORCED")
    if configured is not None:
        return bool(configured)
    return not current_app.testing


def _management_error(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def _current_user_id_optional():
    verify_jwt_in_request(optional=True)
    identity = get_jwt_identity()
    if identity is None:
        return None
    try:
        return int(identity)
    except (TypeError, ValueError):
        return None


def _load_questions_with_choices(quiz_id: int, include_correct: bool = False):
    questions = (
        Question.query.filter_by(quiz_id=quiz_id)
        .order_by(Question.sort_order.asc(), Question.id.asc())
        .all()
    )
    question_ids = [question.id for question in questions]
    choices = (
        Choice.query.filter(Choice.question_id.in_(question_ids))
        .order_by(Choice.sort_order.asc(), Choice.id.asc())
        .all()
        if question_ids
        else []
    )

    choices_by_question_id = {}
    for choice in choices:
        choices_by_question_id.setdefault(choice.question_id, []).append(choice)

    items = []
    for question in questions:
        serialized_choices = []
        for choice in choices_by_question_id.get(question.id, []):
            item = {
                "id": str(choice.id),
                "body": choice.body,
                "sort_order": choice.sort_order,
            }
            if include_correct:
                item["is_correct"] = bool(choice.is_correct)
            serialized_choices.append(item)

        items.append(
            {
                "id": str(question.id),
                "body": question.body,
                "explanation": question.explanation,
                "sort_order": question.sort_order,
                "points": question.points,
                "choices": serialized_choices,
            }
        )
    return items


def _published_quiz_list_response():
    validated, validation_error = _validate_list_query_params(request.args)
    if validation_error:
        return validation_error

    page = validated["page"]
    per_page = validated["per_page"]
    offset = (page - 1) * per_page

    base_query = (
        db.session.query(
            Quiz,
            User.display_name,
            func.count(Question.id).label("question_count"),
        )
        .join(User, User.id == Quiz.author_user_id)
        .outerjoin(Question, Question.quiz_id == Quiz.id)
        .filter(Quiz.status == QuizStatus.published)
        .group_by(Quiz.id, User.display_name)
    )
    total_query = db.session.query(func.count(Quiz.id)).filter(Quiz.status == QuizStatus.published)

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
        base_query.order_by(published_order.desc(), Quiz.id.desc())
        .offset(offset)
        .limit(per_page)
        .all()
    )

    return jsonify(
        {
            "items": [
                _serialize_quiz_list_item(quiz, display_name, question_count)
                for quiz, display_name, question_count in rows
            ],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total_count,
                "total_pages": (total_count + per_page - 1) // per_page if total_count else 0,
            },
            "filters": {"q": validated["q"], "category": validated["category"]},
        }
    )


def _owner_preview_response(quiz: Quiz):
    author = User.query.filter_by(id=quiz.author_user_id).first()
    questions = _load_questions_with_choices(quiz.id, include_correct=False)
    detail = _serialize_quiz_detail(quiz, author.display_name if author else None, questions)
    detail["viewer_is_author"] = True
    detail["play_enabled"] = False
    detail["management_path"] = "/my/quizzes"
    return jsonify({"quiz": detail})


def _best_published_play_subquery():
    return (
        db.session.query(
            QuizPlay.id.label("play_id"),
            QuizPlay.quiz_id.label("quiz_id"),
            QuizPlay.player_user_id.label("user_id"),
            QuizPlay.score.label("score"),
            QuizPlay.correct_answers.label("correct_answers"),
            func.coalesce(QuizPlay.submitted_at, QuizPlay.created_at).label("played_at"),
            func.row_number()
            .over(
                partition_by=(QuizPlay.player_user_id, QuizPlay.quiz_id),
                order_by=(
                    QuizPlay.score.desc(),
                    QuizPlay.correct_answers.desc(),
                    func.coalesce(QuizPlay.submitted_at, QuizPlay.created_at).asc(),
                    QuizPlay.id.asc(),
                ),
            )
            .label("best_rank"),
        )
        .join(Quiz, Quiz.id == QuizPlay.quiz_id)
        .filter(
            QuizPlay.status == PlayStatus.submitted,
            Quiz.status == QuizStatus.published,
        )
        .subquery()
    )


def _published_overall_rankings_response():
    validated, validation_error = _validate_pagination(request.args)
    if validation_error:
        return validation_error

    page = validated["page"]
    per_page = validated["per_page"]
    offset = (page - 1) * per_page
    best_play_subquery = _best_published_play_subquery()

    aggregate_subquery = (
        db.session.query(
            best_play_subquery.c.user_id.label("user_id"),
            func.sum(best_play_subquery.c.score).label("total_score"),
            func.sum(best_play_subquery.c.correct_answers).label("total_correct_answers"),
            func.count(best_play_subquery.c.quiz_id).label("quiz_count"),
            func.min(best_play_subquery.c.played_at).label("first_played_at"),
        )
        .filter(best_play_subquery.c.best_rank == 1)
        .group_by(best_play_subquery.c.user_id)
        .subquery()
    )

    ranking_query = (
        db.session.query(
            aggregate_subquery.c.user_id,
            aggregate_subquery.c.total_score,
            aggregate_subquery.c.total_correct_answers,
            aggregate_subquery.c.quiz_count,
            aggregate_subquery.c.first_played_at,
            User.display_name,
            func.dense_rank()
            .over(
                order_by=(
                    aggregate_subquery.c.total_score.desc(),
                    aggregate_subquery.c.total_correct_answers.desc(),
                    aggregate_subquery.c.first_played_at.asc(),
                    aggregate_subquery.c.user_id.asc(),
                )
            )
            .label("rank"),
        )
        .join(User, User.id == aggregate_subquery.c.user_id)
    )

    total_entries = int(db.session.query(func.count()).select_from(aggregate_subquery).scalar() or 0)
    rows = (
        ranking_query.order_by(
            aggregate_subquery.c.total_score.desc(),
            aggregate_subquery.c.total_correct_answers.desc(),
            aggregate_subquery.c.first_played_at.asc(),
            aggregate_subquery.c.user_id.asc(),
        )
        .offset(offset)
        .limit(per_page)
        .all()
    )

    return jsonify(
        {
            "scope": "overall",
            "ranking_type": "sum_of_best_scores_per_quiz",
            "tie_breaker": [
                "total_score_desc",
                "total_correct_count_desc",
                "first_played_at_asc",
                "user_id_asc",
            ],
            "aggregation": "published_quiz_best_play_per_user_then_sum",
            "items": [
                {
                    "rank": int(row.rank),
                    "total_score": int(row.total_score),
                    "total_correct_count": int(row.total_correct_answers),
                    "quiz_count": int(row.quiz_count),
                    "first_played_at": row.first_played_at.isoformat() if row.first_played_at else None,
                    "user": {
                        "id": str(row.user_id),
                        "display_name": _masked_display_name(row.user_id, row.display_name),
                    },
                }
                for row in rows
            ],
            "pagination": _serialize_pagination(page, per_page, total_entries),
        }
    )


@quiz_management_bp.before_app_request
def enforce_quiz_publication_visibility():
    if not _publication_enforced():
        return None

    if request.method in GET_LIKE_METHODS and request.path == "/api/quizzes":
        return _published_quiz_list_response()

    if request.method in GET_LIKE_METHODS and request.path == "/api/rankings":
        return _published_overall_rankings_response()

    detail_match = QUIZ_DETAIL_PATTERN.match(request.path)
    if request.method in GET_LIKE_METHODS and detail_match:
        quiz_id = int(detail_match.group("quiz_id"))
        quiz = Quiz.query.filter_by(id=quiz_id).first()
        if not quiz:
            return quiz_error_response("quiz/not_found", "Quiz not found.", 404)
        if quiz.status == QuizStatus.published:
            return None
        if _current_user_id_optional() == quiz.author_user_id:
            return _owner_preview_response(quiz)
        return quiz_error_response("quiz/not_found", "Quiz not found.", 404)

    play_match = QUIZ_PLAY_PATTERN.match(request.path)
    if request.method == "POST" and play_match:
        quiz_id = int(play_match.group("quiz_id"))
        quiz = Quiz.query.filter_by(id=quiz_id, status=QuizStatus.published).first()
        if not quiz:
            return quiz_error_response("quiz/not_found", "Quiz not found.", 404)

    ranking_match = QUIZ_RANKING_PATTERN.match(request.path)
    if request.method in GET_LIKE_METHODS and ranking_match:
        quiz_id = int(ranking_match.group("quiz_id"))
        quiz = Quiz.query.filter_by(id=quiz_id, status=QuizStatus.published).first()
        if not quiz:
            return quiz_error_response("quiz/not_found", "Quiz not found.", 404)

    return None


def _validate_management_query(query_params):
    status_value = (query_params.get("status") or "all").strip().lower()
    if status_value not in ALLOWED_STATUS_FILTERS:
        return None, _management_error(
            "quiz/validation_error",
            "status must be one of all, draft, published, archived.",
            400,
        )

    page_raw = query_params.get("page", "1")
    per_page_raw = query_params.get("per_page", "20")
    try:
        page = int(page_raw)
        per_page = int(per_page_raw)
    except (TypeError, ValueError):
        return None, _management_error("quiz/validation_error", "page and per_page must be integers.", 400)
    if page < 1:
        return None, _management_error("quiz/validation_error", "page must be 1 or greater.", 400)
    if per_page < 1 or per_page > 50:
        return None, _management_error("quiz/validation_error", "per_page must be between 1 and 50.", 400)

    return {"status": status_value, "page": page, "per_page": per_page}, None


def _serialize_managed_quiz(quiz: Quiz, question_count: int, play_count: int):
    return {
        "id": str(quiz.id),
        "title": quiz.title,
        "description_summary": _description_summary(quiz.description),
        "category": quiz.category,
        "status": quiz.status.value,
        "question_count": int(question_count),
        "play_count": int(play_count),
        "created_at": quiz.created_at.isoformat() if quiz.created_at else None,
        "updated_at": quiz.updated_at.isoformat() if quiz.updated_at else None,
        "published_at": quiz.published_at.isoformat() if quiz.published_at else None,
        "public_path": f"/quizzes/{quiz.id}" if quiz.status == QuizStatus.published else None,
        "preview_path": f"/quizzes/{quiz.id}",
    }


@quiz_management_bp.get("/me/quizzes")
@jwt_required()
def list_my_quizzes():
    validated, validation_error = _validate_management_query(request.args)
    if validation_error:
        return validation_error

    user_id = int(get_jwt_identity())
    page = validated["page"]
    per_page = validated["per_page"]
    offset = (page - 1) * per_page

    query = (
        db.session.query(
            Quiz,
            func.count(func.distinct(Question.id)).label("question_count"),
            func.count(func.distinct(QuizPlay.id)).label("play_count"),
        )
        .outerjoin(Question, Question.quiz_id == Quiz.id)
        .outerjoin(QuizPlay, QuizPlay.quiz_id == Quiz.id)
        .filter(Quiz.author_user_id == user_id)
        .group_by(Quiz.id)
    )
    total_query = db.session.query(func.count(Quiz.id)).filter(Quiz.author_user_id == user_id)

    if validated["status"] != "all":
        selected_status = QuizStatus(validated["status"])
        query = query.filter(Quiz.status == selected_status)
        total_query = total_query.filter(Quiz.status == selected_status)

    total_count = int(total_query.scalar() or 0)
    rows = query.order_by(Quiz.updated_at.desc(), Quiz.id.desc()).offset(offset).limit(per_page).all()

    return jsonify(
        {
            "items": [
                _serialize_managed_quiz(quiz, question_count, play_count)
                for quiz, question_count, play_count in rows
            ],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total_count,
                "total_pages": (total_count + per_page - 1) // per_page if total_count else 0,
            },
            "filters": {"status": validated["status"]},
        }
    )


def _validate_publishable(quiz_id: int):
    questions = Question.query.filter_by(quiz_id=quiz_id).all()
    if not questions:
        return False, "クイズに問題が登録されていません。"

    question_ids = [question.id for question in questions]
    choices = Choice.query.filter(Choice.question_id.in_(question_ids)).all()
    choices_by_question = {}
    for choice in choices:
        choices_by_question.setdefault(choice.question_id, []).append(choice)

    for question in questions:
        question_choices = choices_by_question.get(question.id, [])
        if len(question_choices) < 2 or len(question_choices) > 6:
            return False, "各問題には2〜6件の選択肢が必要です。"
        if sum(1 for choice in question_choices if choice.is_correct) != 1:
            return False, "各問題には正答が1件必要です。"
    return True, None


def _serialize_status_update(quiz: Quiz, previous_status: QuizStatus):
    return {
        "quiz": {
            "id": str(quiz.id),
            "title": quiz.title,
            "previous_status": previous_status.value,
            "status": quiz.status.value,
            "published_at": quiz.published_at.isoformat() if quiz.published_at else None,
            "public_path": f"/quizzes/{quiz.id}" if quiz.status == QuizStatus.published else None,
        }
    }


@quiz_management_bp.patch("/me/quizzes/<int:quiz_id>/status")
@jwt_required()
def update_my_quiz_status(quiz_id: int):
    user_id = int(get_jwt_identity())
    quiz = Quiz.query.filter_by(id=quiz_id, author_user_id=user_id).first()
    if not quiz:
        return _management_error("quiz/not_found", "Quiz not found.", 404)

    payload = request.get_json(silent=True) or {}
    status_value = payload.get("status")
    if not isinstance(status_value, str):
        return _management_error("quiz/validation_error", "status is required.", 400)
    try:
        target_status = QuizStatus(status_value.strip().lower())
    except ValueError:
        return _management_error(
            "quiz/validation_error",
            "status must be one of draft, published, archived.",
            400,
        )

    previous_status = quiz.status
    if target_status == previous_status:
        return jsonify(_serialize_status_update(quiz, previous_status))

    if target_status not in ALLOWED_TRANSITIONS[previous_status]:
        return _management_error(
            "quiz/invalid_status_transition",
            f"Cannot change status from {previous_status.value} to {target_status.value}.",
            409,
        )

    if target_status == QuizStatus.published:
        publishable, reason = _validate_publishable(quiz.id)
        if not publishable:
            return _management_error("quiz/not_publishable", reason, 409)
        quiz.published_at = datetime.now(timezone.utc)

    quiz.status = target_status
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return _management_error("quiz/status_update_failed", "Failed to update quiz status.", 500)

    return jsonify(_serialize_status_update(quiz, previous_status))
