from flask_jwt_extended import create_access_token

from app import create_app
from app.extensions import db
from app.models import User


class TestConfig:
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = "test"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-32-plus-bytes"
    AUTH_ENABLE_DEV_TOKEN_ENDPOINT = False


def _create_client_with_token(user_id: int, *, create_user: bool):
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
        if create_user:
            db.session.add(
                User(
                    id=user_id,
                    email=f"user-{user_id}@example.com",
                    display_name=f"User {user_id}",
                )
            )
            db.session.commit()
        token = create_access_token(identity=str(user_id))
    return app.test_client(), token


def _auth_header(token: str):
    return {"Authorization": f"Bearer {token}"}


def test_me_uses_sqlalchemy2_session_get_for_existing_user():
    client, token = _create_client_with_token(1, create_user=True)

    response = client.get("/api/auth/me", headers=_auth_header(token))

    assert response.status_code == 200
    assert response.get_json()["user"]["email"] == "user-1@example.com"


def test_me_keeps_user_not_found_contract():
    client, token = _create_client_with_token(999, create_user=False)

    response = client.get("/api/auth/me", headers=_auth_header(token))

    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "auth/user_not_found"
