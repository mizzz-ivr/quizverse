from pathlib import Path


REQUIRED_AUTH_ENVIRONMENT_KEYS = {
    "JWT_ALGORITHM",
    "JWT_ACCESS_TOKEN_EXPIRES_SECONDS",
    "JWT_REFRESH_TOKEN_EXPIRES_SECONDS",
    "JWT_TOKEN_LOCATION",
    "JWT_COOKIE_SECURE",
    "JWT_COOKIE_SAMESITE",
    "JWT_COOKIE_DOMAIN",
    "AUTH_TRUSTED_ORIGINS",
    "AUTH_EXPOSE_TOKEN_IN_RESPONSE",
    "AUTH_ENABLE_DEV_TOKEN_ENDPOINT",
}


def _backend_compose_section() -> str:
    compose_path = Path(__file__).resolve().parents[2] / "docker-compose.yml"
    compose = compose_path.read_text(encoding="utf-8")
    return compose.split("  backend:\n", 1)[1].split("\n  frontend:\n", 1)[0]


def test_docker_compose_forwards_cookie_auth_environment_variables():
    backend_section = _backend_compose_section()

    missing = sorted(
        key
        for key in REQUIRED_AUTH_ENVIRONMENT_KEYS
        if f"      {key}:" not in backend_section
    )
    assert missing == [], (
        "docker-compose.yml backend service does not forward auth settings: "
        + ", ".join(missing)
    )


def test_docker_compose_prefers_bearer_headers_before_cookies():
    backend_section = _backend_compose_section()

    assert "JWT_TOKEN_LOCATION: ${JWT_TOKEN_LOCATION:-headers,cookies}" in backend_section
