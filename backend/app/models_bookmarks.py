from .extensions import db
from .models import TimestampMixin


class QuizBookmark(TimestampMixin, db.Model):
    __tablename__ = "quiz_bookmarks"
    __table_args__ = (
        db.Index("ix_quiz_bookmarks_quiz_id", "quiz_id"),
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
