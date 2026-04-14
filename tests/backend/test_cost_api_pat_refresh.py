"""Tests for the PAT refresh path in the cost API.

Bug: cost/api.py called `session_manager.set(sid, ctx)` which does not exist on
SessionManager. The correct call is `session_manager.set_val(sid, key, value)`.
This test reproduces the AttributeError and verifies the fix.
"""
import os
os.environ.setdefault('PLANNERTOOL_SKIP_SETUP', '1')

import tempfile
from pathlib import Path

import yaml
import pytest
from fastapi.testclient import TestClient

from planner_lib.main import create_app, Config
from planner_lib.accounts.config import AccountPayload


def _make_app(tmp_path: Path) -> TestClient:
    cfg_dir = tmp_path / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)

    # Minimal server config — no azure org, no feature flags
    (cfg_dir / "server_config.yml").write_text(
        yaml.safe_dump({"azure_devops_organization": "", "feature_flags": {}}),
        encoding="utf-8",
    )

    app = create_app(Config(data_dir=str(tmp_path)))
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def client(tmp_path):
    return _make_app(tmp_path)


class _FakeCostService:
    """Minimal cost service stub: returns a valid empty cost result."""

    def estimate_costs(self, ctx):
        return {"projects": {}, "project_types": {}}


def test_cost_post_pat_refresh_does_not_raise_attribute_error(client, caplog):
    """POST /api/cost must not raise AttributeError when session has email but no PAT.

    This reproduces the bug where `session_manager.set(sid, ctx)` was called but
    SessionManager only exposes `set_val(sid, key, value)`. The AttributeError was
    silently swallowed by a broad try/except, causing it to be logged as a failure
    to load user config — masking the real error and preventing reliable PAT refresh.
    """
    import logging

    email = "user@example.com"
    pat = "mytoken"

    container = client.app.state.container

    # Register an account with a PAT so the refresh path can load it
    account_mgr = container.get("account_manager")
    account_mgr.save(AccountPayload(email=email, pat=pat))

    # Create a session for the user but leave PAT absent from session context
    session_mgr = container.get("session_manager")
    sid = "testsessionid123"
    session_mgr._store[sid] = {"email": email}  # intentionally no 'pat' key

    # Replace cost_service with an in-memory stub so we don't need Azure
    container.register_singleton("cost_service", _FakeCostService())

    with caplog.at_level(logging.ERROR, logger="planner_lib.cost.api"):
        response = client.post(
            "/api/cost",
            json={"features": []},
            headers={"X-Session-Id": sid},
        )

    # Must not be a 500
    assert response.status_code != 500, (
        f"Expected non-500; got {response.status_code}: {response.text}"
    )

    # The 'Failed to load user config' error log indicates the AttributeError was
    # swallowed by the broad except. It must NOT appear after the fix.
    error_logs = [r for r in caplog.records if "Failed to load user config" in r.message]
    assert not error_logs, (
        f"session_manager.set() raised a silent AttributeError: {error_logs[0].message}"
    )

    # After processing, the PAT should now be present in the session context
    ctx = session_mgr.get(sid)
    assert ctx is not None
    assert ctx.get("pat") == pat, "PAT should have been stored in session after refresh"
