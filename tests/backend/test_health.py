import time
from planner_lib.config.health import get_health


def test_get_health_contains_fields():
    h = get_health()
    assert isinstance(h, dict)
    assert h.get("status") == "ok"
    assert "start_time" in h
    assert "uptime_seconds" in h
    assert isinstance(h["uptime_seconds"], int)


def test_uptime_increases():
    h1 = get_health()
    time.sleep(1)
    h2 = get_health()
    assert h2["uptime_seconds"] >= h1["uptime_seconds"] + 1
