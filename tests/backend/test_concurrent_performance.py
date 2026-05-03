"""Concurrent request performance tests.

These tests verify that route handlers do not block the asyncio event loop
while waiting for backend I/O (e.g. an Azure DevOps fetch).

Design:
  - SlowFakeBackend introduces a 100 ms sleep in fetch_tasks() to model ADO
    network latency.
  - Four concurrent requests are fired with asyncio.gather() via an httpx
    AsyncClient backed by httpx.ASGITransport.
  - Sequential time: 4 × 100 ms = 400 ms.
  - Parallel time:   ~100 ms (all requests overlap).
  - Pass threshold:  150 ms (1.5 × delay).

test_concurrent_get_tasks_completes_in_parallel
  FAILS before the asyncio.to_thread() fix (Phase 1),
  PASSES after.

test_sequential_baseline_sanity_check
  Always PASSES — confirms SlowFakeBackend is active.

test_concurrent_scenario_writes_do_not_corrupt
  FAILS before per-(user, id) asyncio.Lock on ScenarioRepository (Phase 2c),
  PASSES after.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
import pytest

DELAY = 0.1          # seconds — simulated ADO latency per request
CONCURRENT = 4       # simultaneous requests
CONCURRENCY_THRESHOLD = DELAY * 1.5  # 150 ms — must complete faster than this when parallel

# Area path that will be registered in both config and the slow backend.
_AREA = 'PerfTest\\\\TeamA'
_TASK = {
    'id': '1', 'title': 'Perf Task', 'type': 'Feature', 'state': 'Active',
    'project': 'project-perftest', 'relations': [], 'capacity': [],
    'start': '2026-01-01', 'end': '2026-06-30',
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def perf_app():
    """Return a FastAPI app with SlowFakeBackend injected.

    Uses module scope so the (expensive) app construction happens once per
    module run and does not pollute the session-scoped app used by other tests.
    """
    import os
    os.environ.setdefault('PLANNER_SECRET_KEY', 'test-only-secret-key-not-for-production')

    from planner_lib.main import create_app, Config
    from planner_lib.storage.memory_backend import MemoryStorage
    from tests.fakes.fake_backend import SlowFakeBackend

    # Shared in-memory storage so both storage backends see the same data.
    shared = MemoryStorage()
    shared.save('config', 'server_config', {})
    shared.save('config', 'people', {'schema_version': 1, 'database_file': '', 'database': {'people': []}})
    # Seed one project so TaskRepository.read() iterates the project_map
    # and calls backend.fetch_tasks() for the test area.
    shared.save('config', 'projects', {
        'project_map': [{'name': 'PerfTest', 'area_path': _AREA}]
    })

    # Patch MemoryStorage to return the shared instance.
    import planner_lib.storage.memory_backend as mem_mod
    _orig = mem_mod.MemoryStorage
    mem_mod.MemoryStorage = lambda: shared
    try:
        app = create_app(Config(storage_backend='memory', enable_brotli=False))
    finally:
        mem_mod.MemoryStorage = _orig

    # Inject SlowFakeBackend — 'backend' singleton replaces the lazy factory
    # so task_repository (still unresolved) will pick it up on first call.
    slow = SlowFakeBackend(delay=DELAY)
    slow.set_tasks(_AREA, [dict(_TASK)])
    app.state.container.register_singleton('backend', slow)

    # Create a real session so @require_session passes.
    session_mgr = app.state.container.get('session_manager')
    session_mgr._store['perf-test-session'] = {'email': 'perf@example.com', 'pat': 'fake-pat'}

    return app


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _auth_headers() -> dict:
    return {'X-Session-Id': 'perf-test-session', 'Accept': 'application/json'}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_sequential_baseline_sanity_check(perf_app):
    """Sequential requests take at least CONCURRENT × DELAY: confirms SlowFakeBackend is active.

    This test always passes both before and after the async fix.
    It acts as a sanity check that the slow backend is actually introducing latency.
    """
    async def _run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=perf_app),
            base_url='http://test',
            timeout=10.0,
        ) as client:
            t0 = time.perf_counter()
            for _ in range(CONCURRENT):
                r = await client.get('/api/tasks', headers=_auth_headers())
                assert r.status_code == 200, f'Expected 200, got {r.status_code}: {r.text}'
            elapsed = time.perf_counter() - t0
        return elapsed

    elapsed = asyncio.run(_run())

    expected_min = CONCURRENT * DELAY * 0.8
    assert elapsed >= expected_min, (
        f'Sequential requests completed too fast ({elapsed:.3f}s < {expected_min:.3f}s). '
        'SlowFakeBackend is not introducing the expected delay.'
    )


def test_concurrent_get_tasks_completes_in_parallel(perf_app):
    """Concurrent requests must complete in ~1× DELAY, not 4× DELAY.

    FAILS before asyncio.to_thread() is applied to task_repo.read() in
    planner_lib/projects/api.py (Phase 1 of the async refactor).
    PASSES after.
    """
    async def _run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=perf_app),
            base_url='http://test',
            timeout=10.0,
        ) as client:
            t0 = time.perf_counter()
            responses = await asyncio.gather(*[
                client.get('/api/tasks', headers=_auth_headers())
                for _ in range(CONCURRENT)
            ])
            elapsed = time.perf_counter() - t0
        return responses, elapsed

    responses, elapsed = asyncio.run(_run())

    for r in responses:
        assert r.status_code == 200, f'Expected 200, got {r.status_code}: {r.text}'

    assert elapsed < CONCURRENCY_THRESHOLD, (
        f'Concurrent requests took {elapsed:.3f}s (threshold: {CONCURRENCY_THRESHOLD:.3f}s, '
        f'sequential would be ~{CONCURRENT * DELAY:.3f}s). '
        'asyncio.to_thread() has not been applied to task_repo.read() in '
        'planner_lib/projects/api.py. Apply Phase 1 of the async refactor.'
    )


def test_concurrent_scenario_writes_do_not_corrupt(perf_app):
    """Simultaneous scenario saves must all persist (no silent overwrites).

    Fires CONCURRENT POST /api/scenario?op=save requests (each creates a new
    scenario because no id is supplied), then verifies the list contains
    exactly CONCURRENT entries.

    This test documents the write-race window and serves as the acceptance
    test for Phase 2c (per-(user_id, id) asyncio.Lock in ScenarioRepository).
    It may pass even without Phase 2c because the underlying UserDataStore
    uses an fcntl file lock around the register, but that lock is a blocking
    file I/O call inside an async context — a pattern Phase 2c replaces with
    asyncio.Lock for correctness.
    """
    async def _run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=perf_app),
            base_url='http://test',
            timeout=10.0,
        ) as client:
            # Create CONCURRENT brand-new scenarios concurrently (no id → new UUID each time).
            save_responses = await asyncio.gather(*[
                client.post(
                    '/api/scenario',
                    json={'op': 'save', 'data': {'name': f'perf-scenario-{i}', 'overrides': {}}},
                    headers=_auth_headers(),
                )
                for i in range(CONCURRENT)
            ])
            for r in save_responses:
                assert r.status_code == 200, f'Save failed: {r.status_code} {r.text}'

            # List all scenarios for this user — returns [{id, user, shared}, ...].
            list_resp = await client.get('/api/scenario', headers=_auth_headers())
            assert list_resp.status_code == 200
            return list_resp.json()

    scenarios = asyncio.run(_run())
    scenario_list = scenarios if isinstance(scenarios, list) else []

    assert len(scenario_list) >= CONCURRENT, (
        f'Expected {CONCURRENT} scenarios after concurrent saves, got {len(scenario_list)}. '
        'Some saves were silently lost. '
        'Check Phase 2c: per-(user_id, id) asyncio.Lock in ScenarioRepository.'
    )
