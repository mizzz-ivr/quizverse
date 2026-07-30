from flask import Flask

from .api.admin import admin_bp
from .api.auth import auth_bp
from .api.auth_session import auth_session_bp
from .api import auth_origin_guard  # noqa: F401
from .api.health import health_bp
from .api.quiz_editing import quiz_editing_bp
from .api.quiz_management import quiz_management_bp
from .api.quizzes import quizzes_bp
from .api.rankings import rankings_bp
from .api.status import status_bp
from .config import Config
from .extensions import db, jwt, migrate
from . import models  # noqa: F401


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    jwt.init_app(app)
    migrate.init_app(app, db)

    app.register_blueprint(health_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(auth_session_bp)
    app.register_blueprint(quiz_editing_bp)
    app.register_blueprint(quiz_management_bp)
    app.register_blueprint(quizzes_bp)
    app.register_blueprint(rankings_bp)
    app.register_blueprint(status_bp)

    return app


app = create_app()
