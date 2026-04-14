"""Tests for the double cache warmup bug in main.py.

Bug: When `enable_memory_cache` feature flag is True, both the `lifespan` async
context manager and an `@app.on_event("startup")` handler both call
`CacheWarmupService.warmup_async()`, causing warmup to run twice on every startup.

The fix is to remove the `@app.on_event("startup")` warmup handler since
the `lifespan` context manager already handles it.
"""
import os
os.environ.setdefault('PLANNERTOOL_SKIP_SETUP', '1')

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import yaml
import pytest
from fastapi.testclient import TestClient

from planner_lib.main import create_app, Config


def _make_app_with_memory_cache(tmp_path: Path):
    cfg_dir = tmp_path / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)

    # Enable memory cache via feature flag
    (cfg_dir / "server_config.yml").write_text(
        yaml.safe_dump({
            "azure_devops_organization": "",
            "feature_flags": {
                "enable_memory_cache": True,
            },
            "memory_cache": {
                "max_size_mb": 10,
                "staleness_seconds": 60,
            },
        }),
        encoding="utf-8",
    )

    return create_app(Config(data_dir=str(tmp_path)))


def test_warmup_called_exactly_once_on_startup(tmp_path):
    """CacheWarmupService.warmup_async() must be called exactly once when app starts.

    This test reproduces the double-warmup bug where both lifespan and
    @app.on_event('startup') both schedule warmup_async().
    """
    warmup_call_count = 0

    async def fake_warmup_async(self):
        nonlocal warmup_call_count
        warmup_call_count += 1
        from planner_lib.azure.warmup import WarmupStats
        return WarmupStats(entries_loaded=0, bytes_loaded=0, duration_seconds=0.0, errors=[])

    with patch(
        'planner_lib.azure.warmup.CacheWarmupService.warmup_async',
        new=fake_warmup_async,
    ):
        app = _make_app_with_memory_cache(tmp_path)
        with TestClient(app):
            # TestClient triggers lifespan startup and all on_event startup hooks
            pass

    assert warmup_call_count == 1, (
        f"warmup_async() should be called exactly once on startup, "
        f"but was called {warmup_call_count} times"
    )
