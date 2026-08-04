from app import create_app
from app.extensions import db
from app.models import User, UserRole


class TestConfig:
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = "test"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-32-plus-bytes"
    ADMIN_BOOTSTRAP_EMAILS = ["root@example.com"]


class MaintenanceConfig(TestConfig):
    SERVICE_MAINTENANCE_MODE = True
    SERVICE_MAINTENANCE_TITLE = "定期メンテナンス"
    SERVICE_MAINTENANCE_MESSAGE = "4月末メンテナンスを実施します"
    SERVICE_MAINTENANCE_SCHEDULED_UNTIL = "2026-04-30T00:00:00Z"


def _create_client(config=TestConfig):
    app = create_app(config)
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _register(client, email):
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "safePassword123", "display_name": "Status User"},
    )
    return response.get_json()["access_token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_status_endpoint_returns_components_and_overall():
    _app, client = _create_client()
    response = client.get('/api/status')
    assert response.status_code == 200

    payload = response.get_json()['status']
    assert payload['overall'] in {'normal', 'warning', 'outage', 'maintenance'}
    assert payload['components']['application']['status'] == 'normal'


def test_status_endpoint_maintenance_mode():
    _app, client = _create_client(MaintenanceConfig)
    response = client.get('/api/status')
    assert response.status_code == 200
    assert response.get_json()['status']['overall'] == 'maintenance'


def test_admin_status_requires_authenticated_admin():
    _app, client = _create_client()
    assert client.get('/api/admin/status').status_code == 401

    member = _register(client, 'member@example.com')
    forbidden = client.get(
        '/api/admin/status',
        headers={**_headers(member), 'X-Admin-Mode': 'true'},
    )
    assert forbidden.status_code == 403
    assert forbidden.get_json()['error']['code'] == 'admin/forbidden'


def test_admin_status_returns_internal_field_for_admin():
    app, client = _create_client()
    admin = _register(client, 'root@example.com')
    with app.app_context():
        user = User.query.filter_by(email='root@example.com').one()
        user.role = UserRole.admin
        db.session.commit()

    response = client.get('/api/admin/status', headers=_headers(admin))
    assert response.status_code == 200
    assert response.get_json()['status']['internal']['history'] == 'not_implemented_mvp'
