import importlib.util
import json
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_vercel_config_routes_api_before_spa_fallback():
    config = json.loads((REPOSITORY_ROOT / "vercel.json").read_text(encoding="utf-8"))

    assert config["outputDirectory"] == "frontend/dist"
    assert config["installCommand"] == "npm --prefix frontend install"
    assert config["buildCommand"] == "npm --prefix frontend run build"
    assert config["rewrites"][0] == {
        "source": "/api/(.*)",
        "destination": "/api/index.py",
    }
    assert config["rewrites"][1] == {
        "source": "/(.*)",
        "destination": "/index.html",
    }


def test_vercel_python_entrypoint_exports_flask_app():
    entrypoint = REPOSITORY_ROOT / "api" / "index.py"
    spec = importlib.util.spec_from_file_location("quizverse_vercel_entrypoint", entrypoint)
    module = importlib.util.module_from_spec(spec)

    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert module.app.name == "app"
    assert any(rule.rule == "/api/health" for rule in module.app.url_map.iter_rules())


def test_root_requirements_contains_production_dependencies():
    requirements = (REPOSITORY_ROOT / "requirements.txt").read_text(encoding="utf-8")

    assert "Flask==3.0.3" in requirements
    assert "psycopg[binary]==3.1.19" in requirements
    assert "pytest" not in requirements
