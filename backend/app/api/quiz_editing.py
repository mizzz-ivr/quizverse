import re
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    get_jwt_identity,
    jwt_required,
    verify_jwt_in_request,
)
from sqlalchemy import text

from ..extensions import db
from ..models import Choice, Question, Quiz, QuizPlay, QuizStatus, User
from .quizzes import (
    _next_choice_id,
    _next_question_id,
    _validate_create_quiz_payload,
)

quiz_editing_bp = Blueprint("quiz_editing", __name__, url_prefix="/api/me/quizzes")

QUIZ_STATUS_UPDATE_PATTERN = re.compile(r"^/api/me/quizzes/(?P<quiz_id>\d+)/status$")
QUIZ_PLAY_PATTERN = re.compile(r"^/api/quizzes/(?P<quiz_id>\d+)/play$")
QUIZ_CREATE_PATH = "/api/quizzes"
ID_ALLOCATION_ADVISORY_LOCK_KEY = 7249820371234
QUIZ_ADVISORY_LOCK_BASE = 8_000_000_000_000_000


def _editing_error(code: str, message: str, status_code: int):
    return jsonify({"error": {"code": code, "message": message}}), status_code


def _is_postgresql() -> bool:
    return db.session.get_bind().dialect.name == "postgresql"


def _quiz_advisory_lock_key(quiz_id: int) -> int:
    return QUIZ_ADVISORY_LOCK_BASE + quiz_id


def _lock_shared_id_allocation():
    """Serialize MAX(id) + 1 allocation without locking an FK target."""
    if _is_postgresql():
        return db.session.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": ID_ALLOCATION_ADVISORY_LOCK_KEY},
        ).scalar()

    return (
        db.session.query(User.id)
        .order_by(User.id.asc())
        .with_for_update()
        .first()
    )


def _lock_quiz_shared(quiz_id: int):
    """Allow concurrent reads/plays while conflicting with quiz mutations."""
    if _is_postgresql():
        return db.session.execute(
            text("SELECT pg_advisory_xact_lock_shared(:lock_key)"),
            {"lock_key": _quiz_advisory_lock_key(quiz_id)},
        ).scalar()

    return Quiz.query.filter_by(id=quiz_id).with_for_update().first()


def _lock_quiz_exclusive(quiz_id: int):
    """Block shared readers/plays while a quiz mutation is in progress."""
    if _is_postgresql():
        return db.session.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": _quiz_advisory_lock_key(quiz_id)},
        ).scalar()

    return Quiz.query.filter_by(id=quiz_id).with_for_update().first()


def _lock_owned_quiz_row(quiz_id: int, user_id: int):
    return (
        Quiz.query.filter_by(id=quiz_id, author_user_id=user_id)
        .with_for_update()
        .first()
    )


@quiz_editing_bp.before_app_request
def serialize_related_quiz_mutations():
    """Apply transaction-scoped locks to related quiz requests.

    PostgreSQL shared advisory locks let play submissions coexist. Edit and
    status mutations use the matching exclusive advisory lock and a row lock.
    """
    if request.method == "POST" and request.path == QUIZ_CREATE_PATH:
        verify_jwt_in_request()
        _lock_shared_id_allocation()
        return None

    play_match = QUIZ_PLAY_PATTERN.match(request.path)
    if request.method == "POST" and play_match:
        verify_jwt_in_request()
        _lock_quiz_shared(int(play_match.group("quiz_id")))
        return None

    status_match = QUIZ_STATUS_UPDATE_PATTERN.match(request.path)
    if request.method == "PATCH" and status_match:
        verify_jwt_in_request()
        identity = get_jwt_identity()
        try:
            user_id = int(identity)
        except (TypeError, ValueError):
            return None

        quiz_id = int(status_match.group("quiz_id"))
        owned_quiz = Quiz.query.filter_by(id=quiz_id, author_user_id=user_id).first()
        if owned_quiz:
            _lock_quiz_exclusive(quiz_id)
            _lock_owned_quiz_row(quiz_id, user_id)

    return None


def _owned_quiz_or_404(quiz_id: int, user_id: int, *, for_update: bool = False):
    query = Quiz.query.filter_by(id=quiz_id, author_user_id=user_id)
    if for_update:
        query = query.with_for_update()
    quiz = query.first()
    if not quiz:
        return None, _editing_error("quiz/not_found", "Quiz not found.", 404)
    return quiz, None


def _ensure_editable(quiz: Quiz):
    if quiz.status != QuizStatus.draft:
        return _editing_error(
            "quiz/not_editable",
            "Only draft quizzes can be edited. Archive and restore the quiz to draft before editing.",
            409,
        )

    play_exists = db.session.query(QuizPlay.id).filter(QuizPlay.quiz_id == quiz.id).first()
    if play_exists:
        return _editing_error(
            "quiz/edit_conflict",
            "This quiz has play history and cannot be edited.",
            409,
        )
    return None


def _serialize_editable_quiz(quiz: Quiz):
    questions = (
        Question.query.filter_by(quiz_id=quiz.id)
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

    return {
        "id": str(quiz.id),
        "title": quiz.title,
        "description": quiz.description,
        "category": quiz.category,
        "status": quiz.status.value,
        "editable": True,
        "created_at": quiz.created_at.isoformat() if quiz.created_at else None,
        "updated_at": quiz.updated_at.isoformat() if quiz.updated_at else None,
        "questions": [
            {
                "id": str(question.id),
                "body": question.body,
                "explanation": question.explanation,
                "sort_order": question.sort_order,
                "points": question.points,
                "choices": [
                    {
                        "id": str(choice.id),
                        "body": choice.body,
                        "is_correct": bool(choice.is_correct),
                        "sort_order": choice.sort_order,
                    }
                    for choice in choices_by_question_id.get(question.id, [])
                ],
            }
            for question in questions
        ],
    }


@quiz_editing_bp.get("/<int:quiz_id>")
@jwt_required()
def get_editable_quiz(quiz_id: int):
    user_id = int(get_jwt_identity())

    candidate, not_found = _owned_quiz_or_404(quiz_id, user_id)
    if not_found:
        return not_found

    _lock_quiz_shared(candidate.id)
    quiz, not_found = _owned_quiz_or_404(quiz_id, user_id)
    if not_found:
        return not_found

    not_editable = _ensure_editable(quiz)
    if not_editable:
        return not_editable

    return jsonify({"quiz": _serialize_editable_quiz(quiz)})


@quiz_editing_bp.put("/<int:quiz_id>")
@jwt_required()
def update_draft_quiz(quiz_id: int):
    user_id = int(get_jwt_identity())

    candidate, not_found = _owned_quiz_or_404(quiz_id, user_id)
    if not_found:
        return not_found

    _lock_shared_id_allocation()
    _lock_quiz_exclusive(candidate.id)
    quiz, not_found = _owned_quiz_or_404(quiz_id, user_id, for_update=True)
    if not_found:
        return not_found

    not_editable = _ensure_editable(quiz)
    if not_editable:
        return not_editable

    payload = request.get_json(silent=True)
    if payload is None:
        payload = {}
    elif not isinstance(payload, dict):
        return _editing_error(
            "quiz/validation_error",
            "Request body must be a JSON object.",
            400,
        )

    validated, validation_error = _validate_create_quiz_payload(payload)
    if validation_error:
        return validation_error

    existing_question_ids = [
        question_id
        for (question_id,) in db.session.query(Question.id)
        .filter(Question.quiz_id == quiz.id)
        .all()
    ]
    next_question_id = _next_question_id()
    next_choice_id = _next_choice_id()

    try:
        if existing_question_ids:
            Choice.query.filter(Choice.question_id.in_(existing_question_ids)).delete(
                synchronize_session=False
            )
            Question.query.filter(Question.id.in_(existing_question_ids)).delete(
                synchronize_session=False
            )

        quiz.title = validated["title"]
        quiz.description = validated["description"]
        quiz.category = validated["category"]
        quiz.updated_at = datetime.now(timezone.utc)

        for question_payload in validated["questions"]:
            question = Question(
                id=next_question_id,
                quiz_id=quiz.id,
                body=question_payload["body"],
                explanation=question_payload["explanation"],
                sort_order=question_payload["sort_order"],
                points=1,
            )
            next_question_id += 1
            db.session.add(question)

            for choice_payload in question_payload["choices"]:
                choice = Choice(
                    id=next_choice_id,
                    question_id=question.id,
                    body=choice_payload["body"],
                    is_correct=choice_payload["is_correct"],
                    sort_order=choice_payload["sort_order"],
                )
                next_choice_id += 1
                db.session.add(choice)

        db.session.commit()
    except Exception:
        db.session.rollback()
        return _editing_error(
            "quiz/update_failed",
            "Failed to update quiz.",
            500,
        )

    return jsonify({"quiz": _serialize_editable_quiz(quiz)})
