from copy import deepcopy
import pytest

from planner_lib.migrations import revisions
from planner_lib.migrations.contracts import TARGET_REVISION, validate_registry
from planner_lib.storage.memory_backend import MemoryStorage


def test_upgrade_39_preserves_plan_fields_order_and_other_configuration():
    storage = MemoryStorage()
    projects = {
        'schema_version': 4,
        'container_types': ['Program', 'Team'],
        'allocation_defaults': {'Program': [], 'Team': ['team-id']},
        'project_map': [
            {'id': 'first', 'name': 'First', 'type': 'Team', 'area_path': 'Demo\\First',
             'task_types': ['epic', 'Feature'], 'include_states': ['New'],
             'display_states': ['Active'], 'allocatable_ids': [], 'archived': True},
            {'id': 'second', 'name': 'Second', 'type': 'Program', 'area_path': 'Demo',
             'task_types': ['Epic'], 'iteration_uuid': 'iterations'},
        ],
    }
    storage.save('config', 'projects', projects)
    storage.save('config', 'global_settings', {
        'task_type_hierarchy': ['Epic'], 'state_display_sequence': ['New'],
    })
    storage.save('config', 'unrelated', {'keep': True})
    expected = deepcopy(projects)
    for plan in expected['project_map']:
        plan.pop('include_states', None)
        plan.pop('display_states', None)
        plan['closed_history_days'] = 0

    revisions.upgrade_39(storage)

    assert storage.load('config', 'projects') == expected
    assert storage.load('config', 'ado_processes') == {'schema_version': 1, 'processes': []}
    assert storage.load('config', 'global_settings') == {
        'schema_version': 2, 'process_order': [], 'type_tiers': {},
    }
    assert storage.load('config', 'unrelated') == {'keep': True}
    assert TARGET_REVISION == 41
    validate_registry(revisions.REGISTRY)
    assert revisions.REGISTRY[-3].predecessor == 38
    assert revisions.REGISTRY[-2].predecessor == 39
    assert revisions.REGISTRY[-1].predecessor == 40


def test_fresh_revision_41_initializes_catalogue_and_display_contract():
    storage = MemoryStorage()

    revisions.initialize(storage)

    assert storage.load('config', 'ado_processes') == {'schema_version': 1, 'processes': []}
    assert storage.load('config', 'global_settings') == {
        'schema_version': 2, 'process_order': [], 'type_tiers': {},
    }
    assert storage.load('system', 'schema_state') == {
        'schema_revision': 41, 'last_applied_migration': None, 'initialized_at_revision': 41,
    }


def test_upgrade_40_removes_retired_plan_retention_field_and_enforces_contract():
    from planner_lib.migrations.contracts import SchemaError

    storage = MemoryStorage()
    revisions.initialize(storage)
    plan = {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Plan',
            'type': 'project', 'area_path': 'A', 'task_types': ['feature'],
            'closed_history_days': 0, 'completed_retention_months': 6}
    projects = storage.load('config', 'projects')
    projects['project_map'] = [plan]
    storage.save('config', 'projects', projects)

    with pytest.raises(SchemaError, match='revision 40'):
        revisions.validate_records(storage, 40)

    revisions.upgrade_40(storage)

    assert storage.load('config', 'projects')['project_map'] == [{
        'id': '11111111-1111-4111-8111-111111111111', 'name': 'Plan',
        'type': 'project', 'area_path': 'A', 'task_types': ['feature'],
        'closed_history_days': 0,
    }]
    revisions.validate_records(storage, 40)


@pytest.mark.parametrize('mutation', ['include_states', 'display_states', 'negative_history',
                                     'catalogue_version', 'legacy_display'])
def test_revision_39_record_validation_rejects_retired_or_invalid_contracts(mutation):
    from planner_lib.migrations.contracts import SchemaError
    storage = MemoryStorage()
    revisions.initialize(storage)
    config = storage.load('config', 'projects')
    plan = {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Plan',
            'type': 'project', 'area_path': 'A', 'task_types': ['feature'],
            'closed_history_days': 0}
    config['project_map'] = [plan]
    storage.save('config', 'projects', config)
    revisions.validate_records(storage, 39)
    if mutation in ('include_states', 'display_states'):
        plan[mutation] = []
    elif mutation == 'negative_history':
        plan['closed_history_days'] = -1
    elif mutation == 'catalogue_version':
        storage.save('config', 'ado_processes', {'schema_version': 0, 'processes': []})
    else:
        storage.save('config', 'global_settings', {'task_type_hierarchy': []})
    storage.save('config', 'projects', config)
    with pytest.raises(SchemaError):
        revisions.validate_records(storage, 39)


def test_catalogue_changes_invalidate_snapshot_identity():
    from planner_lib.repository.task_repository import WorkforceTaskRepository

    storage = MemoryStorage()
    repository = WorkforceTaskRepository.__new__(WorkforceTaskRepository)
    repository._storage = storage
    storage.save('config', 'ado_processes', {'schema_version': 1, 'processes': []})
    previous = repository._snapshot_identity()

    storage.save('config', 'ado_processes', {'schema_version': 1, 'processes': [{'id': 'new'}]})

    assert repository._snapshot_identity() != previous