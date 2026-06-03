"""Tests for the extra (non-standard) field values in the task fetch pipeline.

Verifies that:
- DomainTask.fields is populated when raw work item data contains non-standard fields
- AzureAdapter.to_domain() passes through the 'fields' dict from raw work item data
- The 'fields' key is absent / falsy when no extra fields are present
- The pipeline (TaskRepository → backend) works end-to-end without per-project config
"""
from __future__ import annotations

import pytest
from typing import Dict, Any, List, Optional

from planner_lib.domain.tasks import DomainTask
from planner_lib.backend.adapter import AzureAdapter
from tests.fakes.fake_backend import FakeBackend


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

AREA = 'MyOrg\\TeamA'


def _task_with_fields(**extra) -> DomainTask:
    base: DomainTask = {
        'id': '42',
        'title': 'Test Feature',
        'type': 'Feature',
        'state': 'Active',
        'project': 'project-team-a',
        'relations': [],
        'capacity': [],
    }
    base.update(extra)
    return base


def _make_project_repo():
    """Minimal project repository stub — no extra_fields configuration."""
    class _FakeProjectRepo:
        def get_project_map(self):
            return [{
                'id': 'project-team-a',
                'area_path': AREA,
                'task_types': ['Feature'],
                'include_states': None,
            }]
    return _FakeProjectRepo()


def _make_credential_provider():
    class _Prov:
        def get_credential(self, user_id):
            return None
    return _Prov()


# ---------------------------------------------------------------------------
# AzureAdapter: fields pass-through
# ---------------------------------------------------------------------------

class TestAzureAdapterFieldsPassThrough:
    """to_domain() should copy raw_wi['fields'] into DomainTask['fields']."""

    def _adapter(self):
        return AzureAdapter()

    def _null_team_repo(self):
        class _Null:
            def name_to_id(self, name):
                return None
        return _Null()

    def test_fields_dict_present_when_raw_has_fields(self):
        adapter = self._adapter()
        raw = {
            'id': '1',
            'type': 'Feature',
            'title': 'T',
            'state': 'Active',
            'fields': {
                'Microsoft.VSTS.Common.Priority': 2,
                'Custom.ProductType': 'Platform',
            },
        }
        task = adapter.to_domain(
            raw_wi=raw,
            project_slug='project-x',
            team_repository=self._null_team_repo(),
            type_canonical={},
            iteration_map={},
        )
        assert task.get('fields') == {
            'Microsoft.VSTS.Common.Priority': 2,
            'Custom.ProductType': 'Platform',
        }

    def test_fields_absent_when_raw_has_no_fields(self):
        adapter = self._adapter()
        raw = {'id': '2', 'type': 'Epic', 'title': 'E', 'state': 'New'}
        task = adapter.to_domain(
            raw_wi=raw,
            project_slug='project-x',
            team_repository=self._null_team_repo(),
            type_canonical={},
            iteration_map={},
        )
        assert not task.get('fields')

    def test_fields_empty_dict_is_treated_as_absent(self):
        adapter = self._adapter()
        raw = {'id': '3', 'type': 'Bug', 'title': 'B', 'state': 'Active', 'fields': {}}
        task = adapter.to_domain(
            raw_wi=raw,
            project_slug='project-x',
            team_repository=self._null_team_repo(),
            type_canonical={},
            iteration_map={},
        )
        assert not task.get('fields')


# ---------------------------------------------------------------------------
# DomainTask TypedDict: fields key present in type
# ---------------------------------------------------------------------------

def test_domain_task_fields_key_in_typed_dict():
    """DomainTask TypedDict must declare 'fields' as NotRequired."""
    import typing
    hints = typing.get_type_hints(DomainTask, include_extras=True)
    assert 'fields' in hints, (
        "DomainTask must have a 'fields' key for extra ADO field values"
    )


# ---------------------------------------------------------------------------
# TaskRepository: no per-project configuration needed
# ---------------------------------------------------------------------------

def test_task_repository_works_without_extra_fields_config():
    """TaskRepository.read() does not require any extra_fields configuration."""
    from planner_lib.repository.task_repository import TaskRepository

    task_with_fields = _task_with_fields(
        fields={'Microsoft.VSTS.Common.Priority': 1}
    )
    backend = FakeBackend()
    backend.set_tasks(AREA, [task_with_fields])

    repo = TaskRepository(
        backend=backend,
        project_repository=_make_project_repo(),
        credential_provider=_make_credential_provider(),
    )
    results = repo.read()

    assert len(results) == 1
    assert results[0].get('fields') == {'Microsoft.VSTS.Common.Priority': 1}

