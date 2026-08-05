from flask import current_app, request

from .profile import profile_bp


@profile_bp.after_request
def hide_replayable_quiz_answer_keys(response):
    """Prevent submitted empty attempts from becoming an answer-key endpoint.

    A player may review the choice they selected and whether that selection was
    correct. The actual answer key and explanation are disclosed only after the
    quiz is no longer replayable (draft/archived).
    """
    if (
        request.method != "GET"
        or not request.path.startswith("/api/me/plays/")
        or response.status_code != 200
    ):
        return response

    payload = response.get_json(silent=True)
    if not isinstance(payload, dict):
        return response

    play = payload.get("play")
    quiz = play.get("quiz") if isinstance(play, dict) else None
    if not isinstance(quiz, dict):
        return response

    review_unlocked = not bool(quiz.get("is_replayable"))
    payload["review"] = {
        "answer_key_unlocked": review_unlocked,
        "locked_reason": None if review_unlocked else "quiz_is_published",
    }

    if not review_unlocked:
        for question in payload.get("questions", []):
            if not isinstance(question, dict):
                continue
            question["correct_choice_id"] = None
            question["explanation"] = None
            question["explanation_available"] = False
            result = question.get("result")
            for choice in question.get("choices", []):
                if not isinstance(choice, dict):
                    continue
                # A selected correct answer reveals no information beyond the
                # already returned per-question result. Never mark an
                # unselected choice as correct while the quiz is replayable.
                choice["is_correct"] = bool(
                    choice.get("is_selected") and result == "correct"
                )
    else:
        for question in payload.get("questions", []):
            if isinstance(question, dict):
                question["explanation_available"] = bool(question.get("explanation"))

    response.set_data(current_app.json.dumps(payload))
    response.content_type = "application/json"
    return response
