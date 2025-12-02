"""Server health utilities.

Provides a simple `get_health` function returning server status,
start time and uptime in seconds.
"""
from datetime import datetime, timezone
import time

# record process start time at import
_START_TIME = time.time()

def get_health() -> dict:
    """Return a dict representing server health.

    Fields:
    - status: 'ok' or 'error'
    - start_time: ISO 8601 UTC timestamp when the process started
    - uptime_seconds: integer seconds since start
    """
    now = time.time()
    uptime = int(now - _START_TIME)
    start_dt = datetime.fromtimestamp(_START_TIME, tz=timezone.utc)
    return {
        "status": "ok",
        "start_time": start_dt.isoformat(),
        "uptime_seconds": uptime,
    }
