"""Unit tests for FakeBackend / FakeCredentialProvider test doubles.

FakeBackend is used heavily throughout the test suite as a BackendPort
substitute.  These tests verify that the double itself behaves correctly
so tests that rely on it can trust its output.
"""
from __future__ import annotations

import pytest
from tests.fakes.fake_backend import FakeBackend, FakeCredentialProvider

AREA = 'MyOrg\\\\TeamA'
CRED = {'token': 'tok', 'user_id': 'u@example.com'}

_TASKS = [
    {'id': '10', 'title': 'Feature A', 'type': 'Feature', 'state': 'Active', 'project': 'p'},
    {'id': '20', 'title': 'Epic B',    'type': 'Epic',    'state': 'Closed', 'project': 'p'},
]


# ---------------------------------------------------------------------------
# Basic read / write round-trip
# ---------------------------------------------------------------------------

def test_set_and_fetch_tasks():
    b = FakeBackend()
    b.set_tasks(AREA, list(_TASKS))
    result = b.fetch_tasks(AREA)
    assert {t['id'] for t in result} == {'10', '20'}


def test_write_task_updates_state():
    b = FakeBackend()
    b.set_tasks(AREA, [dict(_TASKS[0])])
    result = b.write_task(10, {'state': 'Closed'}, CRED)
    assert result['ok'] is True
    assert result['updated'] == 1
    items = b.fetch_tasks(AREA)
    assert items[0]['state'] == 'Closed'


def test_write_task_unknown_id_returns_not_found():
    b = FakeBackend()
    b.set_tasks(AREA, [dict(_TASKS[0])])
    result = b.write_task(999, {'state': 'Closed'}, CRED)
    assert result['ok'] is False
    assert result['updated'] == 0


def test_raise_on_write_raises():
    b = FakeBackend(raise_on_write=True)
    b.set_tasks(AREA, [dict(_TASKS[0])])
    with pytest.raises(RuntimeError):
        b.write_task(10, {}, CRED)


# ---------------------------------------------------------------------------
# Call recording
# ---------------------------------------------------------------------------

def test_fetch_tasks_calls_are_recorded():
    b = FakeBackend()
    b.set_tasks(AREA, list(_TASKS))
    b.fetch_tasks(AREA, task_types=['Feature'])
    assert len(b.fetch_tasks_calls) == 1
    assert b.fetch_tasks_calls[0]['area_path'] == AREA
    assert b.fetch_tasks_calls[0]['task_types'] == ['Feature']


def test_write_task_calls_are_recorded():
    b = FakeBackend()
    b.set_tasks(AREA, [dict(_TASKS[0])])
    b.write_task(10, {'state': 'Closed'}, CRED)
    assert len(b.write_task_calls) == 1
    assert b.write_task_calls[0]['task_id'] == 10


def test_invalidate_cache_calls_are_counted():
    b = FakeBackend()
    b.invalidate_cache()
    b.invalidate_cache()
    assert b.invalidate_cache_calls == 2


# ---------------------------------------------------------------------------
# History / teams / plans / iterations
# ---------------------------------------------------------------------------

def test_set_and_fetch_history():
    from planner_lib.domain.history import DomainHistoryEntry
    b = FakeBackend()
    entry = DomainHistoryEntry(field='start', value='2026-01-01',
                               changed_at='2026-01-02', changed_by='alice')
    b.set_history(42, [entry])
    result = b.fetch_history(42)
    assert len(result) == 1 and result[0]['field'] == 'start'


def test_fetch_history_unknown_id_returns_empty():
    b = FakeBackend()
    assert b.fetch_history(999) == []


def test_set_and_fetch_teams():
    b = FakeBackend()
    b.set_teams('ProjectX', [{'id': 't1', 'name': 'Arch'}])
    assert b.fetch_teams('ProjectX') == [{'id': 't1', 'name': 'Arch'}]


def test_fetch_teams_unknown_project_returns_empty():
    b = FakeBackend()
    assert b.fetch_teams('Unknown') == []


def test_set_and_fetch_plans():
    b = FakeBackend()
    b.set_plans('ProjectX', [{'id': 'plan1', 'name': 'Q1'}])
    assert b.fetch_plans('ProjectX') == [{'id': 'plan1', 'name': 'Q1'}]


def test_set_and_fetch_iterations():
    b = FakeBackend()
    b.set_iterations('ProjectX', {'Sprint 1': {'startDate': '2026-01-01'}})
    result = b.fetch_iterations('ProjectX')
    assert 'Sprint 1' in result


def test_fetch_markers_always_empty():
    """FakeBackend returns [] for markers; tests that rely on it know this."""
    b = FakeBackend()
    assert b.fetch_markers(AREA) == []


# ---------------------------------------------------------------------------
# FakeCredentialProvider
# ---------------------------------------------------------------------------

def test_credential_provider_returns_credential():
    cp = FakeCredentialProvider('user@example.com', 'my-pat')
    cred = cp.get_credential('user@example.com')
    assert cred is not None
    assert cred['token'] == 'my-pat'
    assert cred['user_id'] == 'user@example.com'


def test_credential_provider_unknown_user_returns_none():
    cp = FakeCredentialProvider('user@example.com', 'my-pat')
    assert cp.get_credential('other@example.com') is None


def test_credential_provider_extra_users():
    extra = {'other@example.com': {'token': 'other-pat', 'user_id': 'other@example.com'}}
    cp = FakeCredentialProvider(extra_users=extra)
    cred = cp.get_credential('other@example.com')
    assert cred is not None
    assert cred['token'] == 'other-pat'
