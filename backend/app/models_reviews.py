from sqlalchemy import CheckConstraint

from .extensions import db
from .models import TimestampMixin


class QuizReview(TimestampMixin, db.Model):
    __tablename__ = "quiz_reviews"
    __table_args__ = (
        CheckConstraint(
            "rating >= 1 AND rating <= 5",
            name="ck_quiz_reviews_rating_range",
        ),
        db.Index("ix_quiz_reviews_quiz_id", "quiz_id"),
    )

    user_id = db.Column(
        db.BigInteger,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    quiz_id = db.Column(
        db.BigInteger,
        db.ForeignKey("quizzes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    rating = db.Column(db.Integer, nullable=False)
    body = db.Column(db.Text, nullable=True)
