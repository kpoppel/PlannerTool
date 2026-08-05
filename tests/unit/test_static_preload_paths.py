"""Tests that the server injects a <base> tag into index.html so the browser
preload scanner resolves asset URLs correctly without relying on JavaScript.
"""
import pytest
from fastapi.testclient import TestClient
from planner_lib.main import create_app, Config


def _make_app(tmp_path, assets=True):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text(
        "<!doctype html><html><head><meta charset=\"UTF-8\" /></head><body></body></html>"
    )
    if assets:
        assets_dir = dist / "assets"
        assets_dir.mkdir()
        (assets_dir / "index.abc123.js").write_text("console.log('hi')")
        (assets_dir / "index.abc123.css").write_text("body{}")
    return create_app(Config(storage_backend="memory", enable_brotli=False, static_dir=str(dist)))


def test_base_tag_injected_at_head(tmp_path):
    """Root response must contain a <base> tag inside <head>."""
    client = TestClient(_make_app(tmp_path), raise_server_exceptions=False)
    resp = client.get("/")
    assert resp.status_code == 200
    assert '<base href="/static/">' in resp.text


def test_base_tag_uses_root_path(tmp_path):
    """<base> href must include the ASGI root_path prefix for sub-path deployments."""
    app = _make_app(tmp_path)
    # Simulate uvicorn --root-path /esw by setting root_path in the ASGI scope directly
    client = TestClient(app, root_path="/esw", raise_server_exceptions=False)
    resp = client.get("/")
    assert resp.status_code == 200
    assert '<base href="/esw/static/">' in resp.text


def test_assets_reachable_via_static_mount(tmp_path):
    """/static/assets/* must be accessible — this is what the base tag resolves to."""
    client = TestClient(_make_app(tmp_path), raise_server_exceptions=False)
    assert client.get("/static/assets/index.abc123.js").status_code == 200
    assert client.get("/static/assets/index.abc123.css").status_code == 200


# ---------------------------------------------------------------------------
# Admin base tag injection
# ---------------------------------------------------------------------------

def _make_admin_app(tmp_path):
    dist = tmp_path / "dist"
    admin = dist / "admin"
    for d in (dist, admin):
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(
            '<!doctype html><html><head><meta charset="UTF-8" /></head><body></body></html>'
        )
    (admin / "login.html").write_text(
        '<!doctype html><html><head><meta charset="UTF-8" /></head><body></body></html>'
    )
    assets = dist / "assets"
    assets.mkdir()
    (assets / "admin.abc123.js").write_text("console.log('admin')")
    return create_app(Config(
        storage_backend="memory",
        enable_brotli=False,
        static_dir=str(dist),
    ))


def test_admin_base_tag_injected(tmp_path):
    """GET /admin/ must contain <base href='/static/admin/'> so ../assets/ resolves to /static/assets/."""
    client = TestClient(_make_admin_app(tmp_path), raise_server_exceptions=False)
    resp = client.get("/admin/")
    assert resp.status_code == 200
    assert '<base href="/static/admin/">' in resp.text


def test_admin_base_tag_uses_root_path(tmp_path):
    """<base> href must include the root_path prefix for sub-path deployments."""
    app = _make_admin_app(tmp_path)
    client = TestClient(app, root_path="/esw", raise_server_exceptions=False)
    resp = client.get("/admin/")
    assert resp.status_code == 200
    assert '<base href="/esw/static/admin/">' in resp.text


def test_admin_login_base_tag_injected(tmp_path):
    client = TestClient(_make_admin_app(tmp_path), raise_server_exceptions=False)
    resp = client.get("/admin/login")
    assert resp.status_code == 200
    assert '<base href="/static/admin/">' in resp.text


def test_admin_assets_reachable_via_static_mount(tmp_path):
    """/static/assets/* must be accessible for admin assets."""
    client = TestClient(_make_admin_app(tmp_path), raise_server_exceptions=False)
    assert client.get("/static/assets/admin.abc123.js").status_code == 200

