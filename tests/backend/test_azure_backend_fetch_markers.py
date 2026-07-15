"""Regression test: AzureDevOpsBackend.fetch_markers must delegate to
AzureClient.get_markers_for_plan() when plan_id is provided (fast path),
and to AzureClient.get_markers() when plan_id is absent (discovery path).

Bug: fetch_markers raised NotImplementedError with a stale comment
"use TaskRepository.list_markers() instead", which caused PlanRepository
to log a WARNING on every request and return no markers.

Performance fix: when plan_id is known (PlanRepository always has it from
area_plan_map), use get_markers_for_plan() instead of get_markers().
get_markers() calls get_delivery_timeline_data() for every plan in the
project; one 500-error plan causes ~7s of urllib3 retries before caching.
"""
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from planner_lib.backend.azure import AzureDevOpsBackend
from planner_lib.backend.port import BackendCredential


_CRED = BackendCredential(token='test-pat', user_id='user1')
_AREA = 'MyOrg\\TeamA'
_PLAN_ID = 'b3a58eba-6464-4b28-99dd-57a50676fe23'
_MARKERS = [
    {'label': 'Release 1', 'start': '2025-01-01', 'end': '2025-01-01', 'color': '#ff0000'},
    {'label': 'Release 2', 'start': '2025-06-01', 'end': '2025-06-01', 'color': '#00ff00'},
]


def _make_backend(markers=None):
    """Return an AzureDevOpsBackend with a stubbed AzureClient."""
    fake_client = MagicMock()
    fake_client.get_markers.return_value = markers if markers is not None else _MARKERS
    fake_client.get_markers_for_plan.return_value = markers if markers is not None else _MARKERS

    @contextmanager
    def _fake_connect(pat):
        yield fake_client

    storage = MagicMock()
    backend = AzureDevOpsBackend(
        organization_url='MyOrg',
        storage=storage,
        team_repository=MagicMock(),
        capacity_service=MagicMock(),
    )
    backend._conn.connect = _fake_connect
    backend._conn._connected = False
    return backend, fake_client


# ---------------------------------------------------------------------------
# Regression: no longer raises NotImplementedError
# ---------------------------------------------------------------------------

def test_fetch_markers_does_not_raise():
    backend, _ = _make_backend()
    result = backend.fetch_markers(_AREA, plan_id=_PLAN_ID, credential=_CRED)
    assert isinstance(result, list)


def test_fetch_markers_returns_marker_list():
    backend, _ = _make_backend()
    result = backend.fetch_markers(_AREA, plan_id=_PLAN_ID, credential=_CRED)
    assert result == _MARKERS


def test_fetch_markers_requires_credential():
    backend, _ = _make_backend()
    from planner_lib.backend.errors import BackendAuthError
    with pytest.raises(BackendAuthError):
        backend.fetch_markers(_AREA, plan_id=_PLAN_ID, credential=None)


# ---------------------------------------------------------------------------
# Fast path: plan_id provided → get_markers_for_plan, not get_markers
# ---------------------------------------------------------------------------

def test_fetch_markers_with_plan_id_uses_fast_path():
    """When plan_id is provided, use get_markers_for_plan (no plan discovery)."""
    backend, fake_client = _make_backend()
    backend.fetch_markers(_AREA, plan_id=_PLAN_ID, credential=_CRED)
    fake_client.get_markers_for_plan.assert_called_once_with('MyOrg', _PLAN_ID)
    fake_client.get_markers.assert_not_called()


def test_fetch_markers_with_plan_id_extracts_project_from_area():
    """Project name is extracted from the first component of area_path."""
    backend, fake_client = _make_backend()
    backend.fetch_markers('ProjectX\\TeamA\\Sub', plan_id=_PLAN_ID, credential=_CRED)
    fake_client.get_markers_for_plan.assert_called_once_with('ProjectX', _PLAN_ID)


# ---------------------------------------------------------------------------
# Slow discovery fallback: no plan_id → get_markers(area_path)
# ---------------------------------------------------------------------------

def test_fetch_markers_without_plan_id_uses_discovery_path():
    """When plan_id is absent, fall back to area-path discovery (admin UI)."""
    backend, fake_client = _make_backend()
    backend.fetch_markers(_AREA, credential=_CRED)
    fake_client.get_markers.assert_called_once_with(_AREA)
    fake_client.get_markers_for_plan.assert_not_called()


def test_fetch_markers_returns_empty_list_when_none_found():
    backend, _ = _make_backend(markers=[])
    result = backend.fetch_markers(_AREA, plan_id=_PLAN_ID, credential=_CRED)
    assert result == []


class _IterationsConfig:
    def fetch_iterations_config(self):
        return {
            'azure_project': 'SW',
            'default_roots': ['FitXP'],
            'project_overrides': {},
        }


def test_fetch_iterations_uses_configured_azure_project_for_default_roots():
    backend, _ = _make_backend()
    backend._config = _IterationsConfig()

    fake_client = MagicMock()
    fake_client.get_iterations.return_value = [
        {
            'path': 'SW\\Iteration\\FitXP\\Sprint 1',
            'name': 'Sprint 1',
            'startDate': '2026-01-01',
            'finishDate': '2026-01-14',
        }
    ]

    @contextmanager
    def _fake_connect(_pat):
        yield fake_client

    backend._conn.connect = _fake_connect
    result = backend.fetch_iterations('Platform_Development', credential=_CRED)

    fake_client.get_iterations.assert_called_once_with(
        'SW',
        root_path='SW\\Iteration\\FitXP',
    )
    assert result == {
        'SW\\FitXP\\Sprint 1': {
            'startDate': '2026-01-01',
            'finishDate': '2026-01-14',
            'name': 'Sprint 1',
        }
    }
