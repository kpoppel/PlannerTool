"""Health response configuration and HTTP contracts."""


def test_get_health_uses_injected_config():
    from planner_lib.server.health import get_health, HealthConfig

    cfg = HealthConfig(server_name="test-server", version="9.9.9")
    result = get_health(cfg)

    assert result["server_name"] == "test-server"
    assert result["version"] == "9.9.9"
    assert result["status"] == "ok"
    assert "uptime_seconds" in result
    assert "start_time" in result



def test_get_health_fallback_when_no_config():
    from planner_lib.server.health import get_health

    result = get_health(None)
    # server_name may be None; version comes from VERSION file
    assert result["status"] == "ok"
    assert result["server_name"] is None



def test_health_endpoint_returns_200(client):
    resp = client.get('/api/health')
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data

