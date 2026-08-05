from functools import wraps

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import and_, func
from sqlalchemy.exc import SQLAlchemyError

from ..authz import resolve_current_user
from ..extensions import db
from ..models import (
    Choice,
    PlayStatus,
    Question,
    Quiz,
    QuizPlay,
    QuizPlayAnswer,
)

profile_bp = Blueprint("profile", __name__, url_prefix="/api/me")

DEFAULT_PAGE = 1
DEFAULT_PER_PAGE = 10
MAX_PER_PAGE = 50
DISPLAY_NAME_MAX_LENGTH = 80
RESULT_FILTERS = {"all", "perfect", "passed", "review"}
PASS_ACCURACY_PERCENT = 70


def _error_response(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def profile_user_required(view):
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
            "profile/validation_error",
            f"{field_name} must be an integer.",
            400,
        )
    if parsed < 1:
        return None, _error_response(
            "profile/validation_error",
            f"{field_name} must be 1 or greater.",
            400,
        )
    return parsed, None


def _validate_history_query(query_params):
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
            "profile/validation_error",
            f"per_page must be between 1 and {MAX_PER_PAGE}.",
            400,
        )

    result_filter = str(query_params.get("result", "all")).strip().lower()
    if result_filter not in RESULT_FILTERS:
        return None, _error_response(
            "profile/validation_error",
            "result must be one of: all, perfect, passed, review.",
            400,
        )

    quiz_id_raw = query_params.get("quiz_id")
    quiz_id = None
    if quiz_id_raw not in (None, ""):
        quiz_id, quiz_id_error = _parse_positive_int(quiz_id_raw, "quiz_id")
        if quiz_id_error:
            return None, quiz_id_error

    return {
        "page": page,
        "per_page": per_page,
        "result": result_filter,
        "quiz_id": quiz_id,
    }, None


def _accuracy(correct_answers: int, total_questions: int):
    if total_questions <= 0:
        return 0.0
    return round((correct_answers / total_questions) * 100, 2)


def _serialize_user(user):
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "role": user.role.value,
        "status": user.status.value,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def _serialize_play(play: QuizPlay, quiz: Quiz):
    accuracy = _accuracy(play.correct_answers, play.total_questions)
    return {
        "id": str(play.id),
        "score": play.score,
        "correct_answers": play.correct_answers,
        "total_questions": play.total_questions,
        "accuracy_percentage": accuracy,
        "result": (
            "perfect"
            if play.total_questions > 0 and play.correct_answers == play.total_questions
            else "passed"
            if accuracy >= PASS_ACCURACY_PERCENT
            else "review"
        ),
        "started_at": play.started_at.isoformat() if play.started_at else None,
        "submitted_at": play.submitted_at.isoformat() if play.submitted_at else None,
        "quiz": {
            "id": str(quiz.id),
            "title": quiz.title,
            "category": quiz.category,
            "status": quiz.status.value,
            "is_replayable": quiz.status.value == "published",
        },
    }


def _apply_result_filter(query, result_filter: str):
    perfect_expression = and_(
        QuizPlay.total_questions > 0,
        QuizPlay.correct_answers == QuizPlay.total_questions,
    )
    passed_expression = and_(
        QuizPlay.total_questions > 0,
        QuizPlay.correct_answers < QuizPlay.total_questions,
        QuizPlay.correct_answers * 100 >= QuizPlay.total_questions * PASS_ACCURACY_PERCENT,
    )
    review_expression = (
        (QuizPlay.total_questions <= 0)
        | (QuizPlay.correct_answers * 100 < QuizPlay.total_questions * PASS_ACCURACY_PERCENT)
    )

    if result_filter == "perfect":
        return query.filter(perfect_expression)
    if result_filter == "passed":
        return query.filter(passed_expression)
    if result_filter == "review":
        return query.filter(review_expression)
    return query


@profile_bp.get("/profile")
@profile_user_required
def get_profile():
    aggregate = (
        db.session.query(
            func.count(QuizPlay.id),
            func.count(func.distinct(QuizPlay.quiz_id)),
            func.coalesce(func.sum(QuizPlay.correct_answers), 0),
            func.coalesce(func.sum(QuizPlay.total_questions), 0),
            func.coalesce(
                func.sum(
                    db.case(
                        (
                            and_(
                                QuizPlay.total_questions > 0,
                                QuizPlay.correct_answers == QuizPlay.total_questions,
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .filter(
            QuizPlay.player_user_id == g.current_user.id,
            QuizPlay.status == PlayStatus.submitted,
        )
        .one()
    )
    play_count, attempted_quiz_count, correct_answers, total_questions, perfect_plays = (
        int(value or 0) for value in aggregate
    )
    created_quiz_count = int(
        db.session.query(func.count(Quiz.id))
        .filter(Quiz.author_user_id == g.current_user.id)
        .scalar()
        or 0
    )

    return jsonify(
        {
            "user": _serialize_user(g.current_user),
            "stats": {
                "play_count": play_count,
                "attempted_quiz_count": attempted_quiz_count,
                "correct_answers": correct_answers,
                "total_questions": total_questions,
                "average_accuracy_percentage": _accuracy(correct_answers, total_questions),
                "perfect_play_count": perfect_plays,
                "created_quiz_count": created_quiz_count,
            },
        }
    )


@profile_bp.patch("/profile")
@profile_user_required
def update_profile():
    payload = request.get_json(silent=True)
    display_name = payload.get("display_name") if isinstance(payload, dict) else None
    if not isinstance(display_name, str) or not display_name.strip():
        return _error_response(
            "profile/validation_error",
            "display_name is required.",
            400,
        )

    normalized_display_name = display_name.strip()
    if len(normalized_display_name) > DISPLAY_NAME_MAX_LENGTH:
        return _error_response(
            "profile/validation_error",
            f"display_name must be {DISPLAY_NAME_MAX_LENGTH} characters or fewer.",
            400,
        )

    if normalized_display_name == g.current_user.display_name:
        return jsonify(
            {
                "user": _serialize_user(g.current_user),
                "meta": {"changed": False},
            }
        )

    try:
        g.current_user.display_name = normalized_display_name
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return _error_response(
            "profile/update_failed",
            "Profile could not be updated.",
            500,
        )

    return jsonify(
        {
            "user": _serialize_user(g.current_user),
            "meta": {"changed": True},
        }
    )


@profile_bp.get("/plays")
@profile_user_required
def list_play_history():
    validated, validation_error = _validate_history_query(request.args)
    if validation_error:
        return validation_error

    query = (
        db.session.query(QuizPlay, Quiz)
        .join(Quiz, Quiz.id == QuizPlay.quiz_id)
        .filter(
            QuizPlay.player_user_id == g.current_user.id,
            QuizPlay.status == PlayStatus.submitted,
        )
    )
    if validated["quiz_id"] is not None:
        query = query.filter(QuizPlay.quiz_id == validated["quiz_id"])
    query = _apply_result_filter(query, validated["result"])

    total = int(query.count())
    rows = (
        query.order_by(QuizPlay.submitted_at.desc(), QuizPlay.id.desc())
        .offset((validated["page"] - 1) * validated["per_page"])
        .limit(validated["per_page"])
        .all()
    )

    return jsonify(
        {
            "items": [_serialize_play(play, quiz) for play, quiz in rows],
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
            "filters": {
                "result": validated["result"],
                "quiz_id": str(validated["quiz_id"]) if validated["quiz_id"] else None,
            },
        }
    )


@profile_bp.get("/plays/<play_id>")
@profile_user_required
def get_play_history_detail(play_id):
    parsed_play_id, play_id_error = _parse_positive_int(play_id, "play_id")
    if play_id_error:
        return play_id_error

    row = (
        db.session.query(QuizPlay, Quiz)
        .join(Quiz, Quiz.id == QuizPlay.quiz_id)
        .filter(
            QuizPlay.id == parsed_play_id,
            QuizPlay.player_user_id == g.current_user.id,
            QuizPlay.status == PlayStatus.submitted,
        )
        .first()
    )
    if not row:
        return _error_response(
            "profile/play_not_found",
            "Play history was not found.",
            404,
        )

    play, quiz = row
    answers = (
        db.session.query(QuizPlayAnswer, Question)
        .join(Question, Question.id == QuizPlayAnswer.question_id)
        .filter(QuizPlayAnswer.quiz_play_id == play.id)
        .order_by(Question.sort_order.asc(), Question.id.asc())
        .all()
    )
    question_ids = [question.id for _, question in answers]
    choices_by_question = {question_id: [] for question_id in question_ids}
    if question_ids:
        choices = (
            Choice.query.filter(Choice.question_id.in_(question_ids))
            .order_by(Choice.question_id.asc(), Choice.sort_order.asc(), Choice.id.asc())
            .all()
        )
        for choice in choices:
            choices_by_question.setdefault(choice.question_id, []).append(choice)

    question_results = []
    for answer, question in answers:
        choices = choices_by_question.get(question.id, [])
        question_results.append(
            {
                "question_id": str(question.id),
                "body": question.body,
                "explanation": question.explanation,
                "points": question.points,
                "selected_choice_id": (
                    str(answer.selected_choice_id) if answer.selected_choice_id else None
                ),
                "correct_choice_id": next(
                    (str(choice.id) for choice in choices if choice.is_correct),
                    None,
                ),
                "result": answer.result.value,
                "points_awarded": answer.points_awarded,
                "choices": [
                    {
                        "id": str(choice.id),
                        "body": choice.body,
                        "is_selected": choice.id == answer.selected_choice_id,
                        "is_correct": choice.is_correct,
                    }
                    for choice in choices
                ],
            }
        )

    return jsonify(
        {
            "play": _serialize_play(play, quiz),
            "questions": question_results,
        }
    )
