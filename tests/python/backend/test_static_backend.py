"""Unit tests specific to StaticBackend.

The contract tests in test_backend_contract.py verify the BackendPort
interface.  These tests focus on StaticBackend-specific behaviour:
- YAML and JSON file loading
- Missing / corrupt file handling
- Optional top-level sections (_history, _teams, _plans, _markers, _iterations)
- write_task() raises NotImplementedError (read-only guard)
- invalidate_cache() forces a re-read from disk
- build_from_flags() classmethod
"""
from __future__ import annotations

import json
import pytest


AREA = 'MyOrg\\\\TeamA'

_TASKS = [
    {'id': '1', 'title': 'Feature A', 'type': 'Feature', 'state': 'Active', 'project': 'p'},
    {'id': '2', 'title': 'Epic B',    'type': 'Epic',    'state': 'Closed', 'project': 'p'},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _yaml_backend(tmp_path, data: dict):
    import yaml
    from planner_lib.backend.static import StaticBackend
    p = tmp_path / 'data.yml'
    p.write_text(yaml.safe_dump(data))
    return StaticBackend(str(p))


def _json_backend(tmp_path, data: dict):
    from planner_lib.backend.static import StaticBackend
    p = tmp_path / 'data.json'
    p.write_text(json.dumps(data))
    return StaticBackend(str(p))


# ---------------------------------------------------------------------------
# File format loading
# ---------------------------------------------------------------------------

def test_load_yaml(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    assert len(b.fetch_tasks(AREA)) == 2


def test_load_json(tmp_path):
    b = _json_backend(tmp_path, {AREA: _TASKS})
    assert len(b.fetch_tasks(AREA)) == 2


def test_missing_file_returns_empty(tmp_path):
    from planner_lib.backend.static import StaticBackend
    b = StaticBackend(str(tmp_path / 'nonexistent.yml'))
    assert b.fetch_tasks(AREA) == []


def test_corrupt_yaml_returns_empty(tmp_path):
    from planner_lib.backend.static import StaticBackend
    p = tmp_path / 'bad.yml'
    p.write_text(': invalid: yaml: [{')
    b = StaticBackend(str(p))
    assert b.fetch_tasks(AREA) == []


def test_unsupported_extension_returns_empty(tmp_path):
    from planner_lib.backend.static import StaticBackend
    p = tmp_path / 'data.csv'
    p.write_text('id,title\n1,foo')
    b = StaticBackend(str(p))
    assert b.fetch_tasks(AREA) == []


# ---------------------------------------------------------------------------
# Task filtering
# ---------------------------------------------------------------------------

def test_filter_by_type(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    result = b.fetch_tasks(AREA, task_types=['Feature'])
    assert [t['id'] for t in result] == ['1']


def test_filter_by_state(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    result = b.fetch_tasks(AREA, include_states=['Closed'])
    assert [t['id'] for t in result] == ['2']


def test_filter_combined(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    result = b.fetch_tasks(AREA, task_types=['Feature'], include_states=['Active'])
    assert len(result) == 1 and result[0]['id'] == '1'


def test_filter_no_match(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    assert b.fetch_tasks(AREA, task_types=['UserStory']) == []


# ---------------------------------------------------------------------------
# Optional top-level sections
# ---------------------------------------------------------------------------

def test_fetch_teams_from_optional_section(tmp_path):
    data = {AREA: _TASKS, '_teams': {'ProjectX': [{'id': 't1', 'name': 'Arch'}]}}
    b = _yaml_backend(tmp_path, data)
    assert b.fetch_teams('ProjectX') == [{'id': 't1', 'name': 'Arch'}]


def test_fetch_teams_missing_section_returns_empty(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    assert b.fetch_teams('ProjectX') == []


def test_fetch_plans_from_optional_section(tmp_path):
    data = {AREA: _TASKS, '_plans': {'ProjectX': [{'id': 'p1', 'name': 'Q1'}]}}
    b = _yaml_backend(tmp_path, data)
    assert b.fetch_plans('ProjectX') == [{'id': 'p1', 'name': 'Q1'}]


def test_fetch_markers_from_optional_section(tmp_path):
    data = {AREA: _TASKS, '_markers': {AREA: [{'date': '2026-01-01', 'label': 'PI start'}]}}
    b = _yaml_backend(tmp_path, data)
    markers = b.fetch_markers(AREA)
    assert len(markers) == 1 and markers[0]['label'] == 'PI start'


def test_fetch_iterations_from_optional_section(tmp_path):
    iters = {'Sprint 1': {'startDate': '2026-01-01', 'finishDate': '2026-01-14'}}
    data = {AREA: _TASKS, '_iterations': {'ProjectX': iters}}
    b = _yaml_backend(tmp_path, data)
    assert b.fetch_iterations('ProjectX') == iters


def test_fetch_history_from_optional_section(tmp_path):
    history = {'42': [{'field': 'start', 'value': '2026-01-01', 'changed_at': '', 'changed_by': ''}]}
    data = {AREA: _TASKS, '_history': history}
    b = _yaml_backend(tmp_path, data)
    entries = b.fetch_history(42)
    assert len(entries) == 1 and entries[0]['field'] == 'start'


def test_fetch_history_missing_item_returns_empty(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    assert b.fetch_history(999) == []


# ---------------------------------------------------------------------------
# Read-only guard
# ---------------------------------------------------------------------------

def test_write_task_raises_not_implemented(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    cred = {'token': 'tok', 'user_id': 'u@example.com'}
    with pytest.raises(NotImplementedError):
        b.write_task(1, {'state': 'Closed'}, cred)


# ---------------------------------------------------------------------------
# invalidate_cache forces re-read from disk
# ---------------------------------------------------------------------------

def test_invalidate_cache_forces_reload(tmp_path):
    import yaml
    from planner_lib.backend.static import StaticBackend

    p = tmp_path / 'data.yml'
    p.write_text(yaml.safe_dump({AREA: _TASKS[:1]}))   # 1 task initially
    b = StaticBackend(str(p))

    assert len(b.fetch_tasks(AREA)) == 1   # populates in-process cache

    # Update the file on disk
    p.write_text(yaml.safe_dump({AREA: _TASKS}))       # now 2 tasks

    # Without invalidation the stale cache is served
    assert len(b.fetch_tasks(AREA)) == 1

    # After invalidation the new data is read
    b.invalidate_cache()
    assert len(b.fetch_tasks(AREA)) == 2


def test_invalidate_cache_result(tmp_path):
    b = _yaml_backend(tmp_path, {AREA: _TASKS})
    result = b.invalidate_cache()
    assert result['ok'] is True
    assert 'static_data' in result['invalidated']


# ---------------------------------------------------------------------------
# build_from_flags classmethod
# ---------------------------------------------------------------------------

def test_build_from_flags_uses_static_data_path(tmp_path):
    import yaml
    from planner_lib.backend.static import StaticBackend

    p = tmp_path / 'custom.yml'
    p.write_text(yaml.safe_dump({AREA: _TASKS}))

    b = StaticBackend.build_from_flags(
        {'use_static_backend': True, 'static_data_path': str(p)},
    )
    assert isinstance(b, StaticBackend)
    assert len(b.fetch_tasks(AREA)) == 2


def test_build_from_flags_default_path_accepted(tmp_path):
    """build_from_flags must not raise even if the default path doesn't exist."""
    from planner_lib.backend.static import StaticBackend
    b = StaticBackend.build_from_flags({})
    assert isinstance(b, StaticBackend)
    assert b.fetch_tasks(AREA) == []   # missing file → empty, no exception
