from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CI_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "ci.yml"


def _workflow_text() -> str:
    return CI_WORKFLOW.read_text(encoding="utf-8")


def test_official_github_actions_use_node24_runtime_compatible_major_versions():
    workflow = _workflow_text()

    assert workflow.count("uses: actions/checkout@v6") == 2
    assert "uses: actions/setup-python@v6" in workflow
    assert "uses: actions/setup-node@v6" in workflow

    for legacy_reference in (
        "actions/checkout@v4",
        "actions/checkout@v5",
        "actions/setup-python@v5",
        "actions/setup-node@v4",
        "actions/setup-node@v5",
    ):
        assert legacy_reference not in workflow


def test_ci_workflow_declares_read_only_repository_permission():
    workflow = _workflow_text()

    assert "permissions:\n  contents: read\n" in workflow
