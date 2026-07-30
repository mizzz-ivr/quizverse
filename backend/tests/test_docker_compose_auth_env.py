from pathlib import Path


REQUIRED_AUTH_ENVIRONMENT_KEYS = {
    "JWT_ALGORITHM",
    "JWT_ACCESS_TOKEN_EXPIRES_SECONDS",
    "JWT_REFRESH_TOKEN_EXPIRES_SECONDS",
    "JWT_TOKEN_LOCATION",
    "JWT_COOKIE_SECURE",
    "JWT_COOKIE_SAMESITE",
    "JWT_COOKIE_DOMAIN",
    "AUTH_EXPOSE_TOKEN_IN_RESPONSE",
    "AUTH_ENABLE_DEV_TOKEN_ENDPOINT",
}


def test_docker_compose_forwards_cookie_auth_environment_variables():
    compose_path = Path(__file__).resolve().parents[2] / "docker-compose.yml"
    compose = compose_path.read_text(encoding="utf-8")

    backend_section = compose.split("  backend:\n", 1)[1].split("\n  frontend:\n", 1)[0]

    missing = sorted(
        key
        for key in REQUIRED_AUTH_ENVIRONMENT_KEYS
        if f"      {key}:" not in backend_section
    )
    assert missing == [], (
        "docker-compose.yml backend service does not forward auth settings: "
        + ", ".join(missing)
    )
