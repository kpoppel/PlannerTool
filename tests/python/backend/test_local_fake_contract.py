"""Backend-neutral contracts exercised by ADO-family classes and a minimal local fake."""
from types import SimpleNamespace

import pytest

from planner_lib.backend.port import (
    TASK_CAPABILITIES, BatchTaskBackend, CatalogueBackend, TaskBackend,
)
from planner_lib.repository.task_repository import TaskRepository

PLAN = {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Local plan', 'type': 'project',
        'task_types': ['Feature'], 'closed_history_days': 0}


class _LocalFake:
    """Plan-owned tasks without ADO area paths, atomic batch writes and own catalogue."""

    BACKEND_ID = 'local'
    CAPABILITIES = frozenset({'task_read', 'task_publish', 'task_create', 'field_merge'})
    backend_id = 'local'
    is_remote = False

    def __init__(self):
        self.tasks = {'a1': {'id': 'a1', 'title': 'A', 'type': 'Feature', 'process_id': 'p',
                             'state': 'New', 'project': PLAN['id'], 'revision': 1}}

    def fetch_plan_tasks(self, plan, credential=None):
        return [dict(task) for task in self.tasks.values() if task['project'] == plan['id']]

    def fetch_task_context(self, seeds, credential=None):
        return [{**seed, 'presentationPlanIds': list(seed['sourcePlanIds'])} for seed in seeds]

    def write_task(self, task_id, updates, credential):
        raise AssertionError('Batch backends must not receive per-task writes')

    def write_tasks(self, updates, credential, *, actor_id, validate):
        originals = {identity: dict(task) for identity, task in self.tasks.items()}
        for update in updates:
            self.tasks[update['id']].update({k: v for k, v in update.items() if k not in ('id', 'base')})
        validate(originals, list(self.tasks.values()))
        return {'updated': len(updates), 'errors': [], 'conflicts': []}

    def invalidate_cache(self):
        return {}

    def work_item_display(self):
        return [{'process_id': 'p', 'tiers': [[{'name': 'Feature', 'states': [
            {'name': 'New', 'category': 'Proposed'}]}]]}]


def _transport_classes():
    from planner_lib.backend.registry import _ado_transport_classes
    return list(_ado_transport_classes().values())


@pytest.mark.parametrize('cls', _transport_classes(), ids=lambda cls: cls.__name__)
def test_ado_family_declares_identity_and_known_capabilities(cls):
    assert cls.BACKEND_ID == 'ado'
    assert cls.CAPABILITIES <= TASK_CAPABILITIES
    assert 'task_read' in cls.CAPABILITIES


def test_local_fake_satisfies_backend_neutral_protocols():
    fake = _LocalFake()
    assert isinstance(fake, TaskBackend)
    assert isinstance(fake, BatchTaskBackend)
    assert isinstance(fake, CatalogueBackend)
    assert fake.CAPABILITIES <= TASK_CAPABILITIES


@pytest.mark.parametrize('cls', _transport_classes(), ids=lambda cls: cls.__name__)
def test_every_task_backend_owns_its_catalogue(cls):
    from planner_lib.backend.local import LocalTaskBackend
    assert issubclass(cls, CatalogueBackend)
    assert issubclass(LocalTaskBackend, CatalogueBackend)


def test_task_backends_do_not_depend_on_workforce_rules():
    import ast
    import pathlib

    import planner_lib
    root = pathlib.Path(planner_lib.__file__).parent
    for path in (root / 'local' / 'tasks.py', root / 'backend' / 'local.py'):
        imported = {node.module for node in ast.walk(ast.parse(path.read_text()))
                    if isinstance(node, ast.ImportFrom)}
        assert not imported & {'planner_lib.cost.allocation_rule', 'planner_lib.domain.allocation_availability',
                               'planner_lib.domain.teams'}, path


def test_local_fake_reads_and_publishes_through_the_shared_repository():
    fake = _LocalFake()
    repository = TaskRepository(fake, SimpleNamespace(get_project_map=lambda: [PLAN]),
                                SimpleNamespace(get_credential=lambda user_id: None))
    [task] = repository.read(project_id=PLAN['id'])
    assert task['sourcePlanIds'] == [PLAN['id']]
    assert task['presentationPlanIds'] == [PLAN['id']]
    result = repository.write([{'id': 'a1', 'start': '2026-01-05',
                                'base': {'revision': 1, 'fields': {'start': None}}}], 'actor')
    assert result == {'updated': 1, 'errors': [], 'conflicts': []}
    assert repository.read()[0]['start'] == '2026-01-05'
