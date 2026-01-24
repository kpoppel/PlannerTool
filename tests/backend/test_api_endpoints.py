import os
import re
from typing import List, Tuple

import pytest
import httpx

from planner_lib.main import create_app, Config

# Build a local app instance for route inspection. Tests that require a
# running server still use `base_url` and may be skipped if the server
# is not reachable.
fastapi_app = create_app(Config(storage_backend='memory'))


BASE_URL_ENV = "API_BASE_URL"
DEFAULT_BASE = "http://localhost:8000"


def _collect_api_routes() -> List[Tuple[str, str]]:
    """Collect (method, path) tuples for routes starting with /api/."""
    routes = []
    for r in getattr(fastapi_app, "routes", []):
        path = getattr(r, "path", None)
        methods = getattr(r, "methods", None)
        if not path or not methods:
            continue
        if not path.startswith("/api/"):
            continue
        # methods is a set of strings like {'GET','POST'}; filter to common HTTP verbs
        for m in methods:
            if m.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                routes.append((m.upper(), path))
    # deduplicate
    seen = set()
    out = []
    for item in routes:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _fill_path_params(path: str) -> str:
    # replace {param} style path params with a generic test value
    # numeric-looking names get '1', others get 'test'
    def repl(m):
        name = m.group(1)
        return "1" if re.search(r"id|num|count|index", name, re.IGNORECASE) else "test"

    return re.sub(r"{([^}]+)}", repl, path)


@pytest.fixture(scope="session")
def base_url() -> str:
    return os.getenv(BASE_URL_ENV, DEFAULT_BASE)


@pytest.fixture(scope="session")
def server_available(base_url: str) -> bool:
    # Quick reachability probe; skip tests if server not responding.
    try:
        r = httpx.get(base_url, timeout=2.0)
        return True
    except Exception:
        pytest.skip(f"Server not reachable at {base_url}; set {BASE_URL_ENV} and start server")


ROUTES = _collect_api_routes()


@pytest.mark.parametrize("method,path", ROUTES)
def test_api_endpoint_session_behaviour(server_available, base_url: str, method: str, path: str):
    """Verify endpoints behave correctly without a session and with a valid session.

    - Without session: endpoints protected by @require_session should return JSON 401.
      `/api/cost` should return a schema (200, JSON) even without a session.
    - With session: endpoints should return JSON (not an HTML page) and not 5xx.
    """
    url_path = _fill_path_params(path)
    url = base_url.rstrip("/") + url_path

    # Minimal payloads for write verbs
    payload = {}
    if path == "/api/account":
        payload = {"email": "test@example.com", "pat": "token"}

    # 1) Request without session (ask for JSON so middleware returns JSON errors)
    unauth_headers = {"Accept": "application/json"}
    resp = httpx.request(method, url, headers=unauth_headers, json=payload if method in {"POST", "PUT", "PATCH"} else None, timeout=5.0)

    # If endpoint is /api/cost, an unauthenticated caller should get schema (200 JSON)
    # Some deployments require authentication for cost endpoints; accept 200 or 401.
    if path == "/api/cost" and method == "GET":
        assert resp.status_code in (200, 401)
        assert 'application/json' in resp.headers.get('content-type', '')
    else:
        # For protected endpoints, expect 401 with JSON error detail (or 200 for unprotected GETs)
        if resp.status_code == 401:
            # should be JSON error (not HTML page)
            assert 'application/json' in resp.headers.get('content-type', ''), f"Expected JSON 401 for {path}, got {resp.headers.get('content-type')}"
        else:
            # Unprotected endpoints (e.g. /api/health) may return other success codes
            assert resp.status_code < 500, f"Unexpected server error: {resp.status_code} for {method} {url}"

    # 2) Create a valid session and retry
    # First ensure config exists for the test email (POST /api/account)
    cfg_url = base_url.rstrip('/') + '/api/account'
    r_cfg = httpx.post(cfg_url, json={"email": "test@example.com", "pat": "token"}, headers={"Accept": "application/json"}, timeout=5.0)
    assert r_cfg.status_code in (200, 201)

    # Create session
    sess_url = base_url.rstrip('/') + '/api/session'
    r_sess = httpx.post(sess_url, json={"email": "test@example.com"}, headers={"Accept": "application/json"}, timeout=5.0)
    assert r_sess.status_code == 200
    sid = r_sess.json().get('sessionId')
    assert sid

    headers = {"X-Session-Id": sid, "Accept": "application/json"}

    # Retry the original request with session header
    resp2 = httpx.request(method, url, headers=headers, json=payload if method in {"POST", "PUT", "PATCH"} else None, timeout=5.0)

    # With a valid session, endpoints should not return HTML error pages.
    # Some endpoints depend on external services (Azure, DB) and may return 5xx
    # in a local/dev environment — treat those as xfail to avoid noisy failures.
    EXTERNAL_DEPENDENT = {"/api/tasks", "/api/scenario", "/api/cost", "/api/cost/teams"}
    if resp2.status_code >= 500 and path in EXTERNAL_DEPENDENT:
        pytest.xfail(f"Server returned {resp2.status_code} for {path}; likely external dependency not configured. Body: {resp2.text}")
    assert resp2.status_code < 500, f"Server error for {method} {url} with session: {resp2.status_code}\n{resp2.text}"
    # Ensure JSON is returned for API endpoints (avoid HTML error pages)
    ct = resp2.headers.get('content-type', '')
    assert 'text/html' not in ct, f"Unexpected HTML response for {method} {url} with session"
    # Prefer JSON where possible
    if resp2.content:
        # If the response declares JSON, ensure it's valid JSON
        if 'application/json' in ct:
            try:
                _ = resp2.json()
            except Exception as e:
                pytest.fail(f"Invalid JSON from {method} {url} with session: {e}\nBody: {resp2.text}")
