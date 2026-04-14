"""Server health utilities.

Provides a simple `get_health` function returning server status,
start time and uptime in seconds. The `server_name` is injected at
app construction time via `HealthConfig` to avoid reading storage on
every health request.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
import time
import os

# Record process start time once at module import.
_START_TIME = time.time()


@dataclass
class HealthConfig:
    """Immutable health metadata set once at app construction time."""
    server_name: Optional[str] = None
    version: str = "unknown"


def _read_version() -> str:
    version_file = os.path.join(os.path.dirname(__file__), "../../VERSION")
    if os.path.exists(version_file):
        with open(version_file, "r") as f:
            return f.read().strip()
    return "unknown"


def get_health(config: Optional[HealthConfig] = None) -> dict:
    """Return a dict representing server health.

    Fields:
    - status: 'ok'
    - start_time: ISO 8601 UTC timestamp when the process started
    - uptime_seconds: integer seconds since start
    - version: application version string
    - server_name: optional human-readable server identifier
    """
    now = time.time()
    uptime = int(now - _START_TIME)
    start_dt = datetime.fromtimestamp(_START_TIME, tz=timezone.utc)

    if config is not None:
        version = config.version
        server_name = config.server_name
    else:
        # Fallback for callers that do not inject a HealthConfig (e.g. tests).
        version = _read_version()
        server_name = None

    return {
        "status": "ok",
        "start_time": start_dt.isoformat(),
        "uptime_seconds": uptime,
        "version": version,
        "server_name": server_name,
    }
