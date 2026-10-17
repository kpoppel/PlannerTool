from copy import deepcopy

import pytest

from planner_lib.azure.catalogue import (
    CatalogueError, merge_catalogue, resolve_plan_process, select_imports, sync_display,
)


def catalogue():
    def item(name, backlog, level='portfolio', imported=True):
        return {'reference_name': name, 'name': name, 'backlog': backlog,
                'backlog_level': level, 'imported': imported, 'missing': False,
                'states': [{'name': 'New', 'category': 'Proposed', 'order': 1}]}
    return {'schema_version': 1, 'processes': [{
        'id': 'agile', 'name': 'Agile', 'projects': ['Platform'], 'loaded_at': '2026-10-17T00:00:00Z',
        'types': [item('Epic', 'Epics'), item('Feature', 'Features'),
                  item('User Story', 'Stories', 'requirement'),
                  item('Bug', 'Stories', 'requirement', False),
                  item('Task', 'Tasks', 'task', False)],
    }]}


def plan():
    return {'id': 'plan', 'name': 'Platform plan', 'area_path': 'platform\\Team',
            'task_types': ['feature']}


def catalogue_storage(projects):
    from planner_lib.storage.memory_backend import MemoryStorage
    storage = MemoryStorage()
    stored = task_catalogue(projects)
    storage.save('config', 'ado_processes', stored)
    storage.save('config', 'global_settings', sync_display(stored, {
        'schema_version': 2, 'process_order': [], 'type_tiers': {},
    }))
    return storage


def task_catalogue(projects):
    states = [
        {'name': name, 'category': category, 'order': order}
        for order, (name, category) in enumerate([
            ('New', 'Proposed'), ('Defined', 'Proposed'), ('Active', 'InProgress'),
            ('Resolved', 'Resolved'), ('Closed', 'Completed'), ('Done', 'Completed'),
            ('Terminated', 'Completed'), ('Removed', 'Removed'), ('Discarded', 'Removed'),
        ])
    ]
    names = ['Epic', 'Feature', 'User Story', 'Requirement', 'Change Request', 'Bug',
             'Story', 'Test Case', 'Issue', 'Initiative', 'Task', 'Implementation Step']
    return {'schema_version': 1, 'processes': [{
        'id': 'test-process', 'name': 'Test process', 'projects': list(projects),
        'loaded_at': '2026-10-17T00:00:00Z',
        'types': [{'reference_name': name, 'name': name, 'backlog': name,
                   'backlog_level': 'task' if name in ('Task', 'Implementation Step') else 'portfolio',
                   'imported': name not in ('Task', 'Implementation Step'),
                   'missing': False, 'states': deepcopy(states)} for name in names],
    }]}


def test_projects_payload_uses_catalogue_display_tiers_and_state_order():
    from planner_lib.backend.config import ConfigBackend
    from planner_lib.storage.memory_backend import MemoryStorage

    storage = MemoryStorage()
    stored = catalogue()
    stored['processes'][0]['types'][1]['states'] = [
        {'name': 'Done', 'category': 'Completed', 'order': 4},
        {'name': 'New', 'category': 'Proposed', 'order': 1},
    ]
    storage.save('config', 'ado_processes', stored)
    storage.save('config', 'global_settings', {
        'schema_version': 2, 'process_order': ['agile'],
        'type_tiers': {'agile': [['Epic'], ['Feature'], ['User Story']]},
    })
    storage.save('config', 'projects', {
        'schema_version': 4, 'container_types': ['project'], 'allocation_defaults': {'project': []},
        'project_map': [{**plan(), 'id': '11111111-1111-4111-8111-111111111111',
                         'type': 'project', 'closed_history_days': 0}],
    })

    project, = ConfigBackend(storage).fetch_projects()

    assert project['work_item_display'] == [{
        'process_id': 'agile',
        'tiers': [[{'name': 'Epic', 'states': [{'name': 'New', 'category': 'Proposed'}]}],
                  [{'name': 'Feature', 'states': [
                      {'name': 'New', 'category': 'Proposed'},
                      {'name': 'Done', 'category': 'Completed'}]}],
                  [{'name': 'User Story', 'states': [{'name': 'New', 'category': 'Proposed'}]}]],
    }]
    assert not {'display_states', 'state_categories', 'task_type_hierarchy',
                'state_display_sequence'} & project.keys()
    assert storage.load('config', 'ado_processes') == stored


def test_plan_schema_has_only_revision_39_fields():
    from planner_lib.admin.schema import get_schema

    schema = get_schema('projects')['properties']['project_map']['items']
    assert schema['additionalProperties'] is False
    assert 'include_states' not in schema['properties']
    assert 'display_states' not in schema['properties']
    assert schema['properties']['closed_history_days'] == {
        'type': 'integer', 'title': 'Closed work history', 'minimum': 0, 'default': 0,
    }
    assert schema['properties']['task_types']['minItems'] == 1


def test_merge_preserves_imports_by_reference_and_marks_removed_types():
    stored = catalogue()
    fresh = deepcopy(stored['processes'])
    fresh[0]['types'] = fresh[0]['types'][1:]
    fresh[0]['types'][0]['name'] = 'Renamed Feature'
    for item in fresh[0]['types']:
        item['imported'] = False
    merged = merge_catalogue(stored, fresh, 'now')
    types = {item['reference_name']: item for item in merged['processes'][0]['types']}
    assert types['Feature']['imported'] is True
    assert types['Feature']['name'] == 'Renamed Feature'
    assert types['Epic']['missing'] is True
    assert types['Epic']['imported'] is True
    assert types['Bug']['imported'] is False
    assert merged['processes'][0]['loaded_at'] == 'now'
    assert stored == catalogue()


def test_merge_preserves_imported_types_from_disappeared_process():
    merged = merge_catalogue(catalogue(), [], 'now')
    assert all(item['missing'] for item in merged['processes'][0]['types'])


def test_resolve_plan_process_case_insensitive():
    assert resolve_plan_process(plan(), catalogue())['id'] == 'agile'


@pytest.mark.parametrize('change,code', [('project', 'process_not_imported'),
                                        ('imports', 'process_not_imported'),
                                        ('type', 'type_not_imported')])
def test_resolve_plan_process_rejects_unavailable_metadata(change, code):
    content = catalogue()
    entry = plan()
    if change == 'project':
        entry['area_path'] = 'Unknown\\Team'
    if change == 'imports':
        for item in content['processes'][0]['types']:
            item['imported'] = False
    if change == 'type':
        entry['task_types'] = ['Task']
    with pytest.raises(CatalogueError) as error:
        resolve_plan_process(entry, content)
    assert error.value.code == code


@pytest.mark.parametrize('target,missing', [('Task', False), ('Bug', True)])
def test_import_rejects_task_or_newly_missing_type(target, missing):
    stored = catalogue()
    item = next(item for item in stored['processes'][0]['types'] if item['name'] == target)
    item['missing'] = missing
    submitted = deepcopy(stored)
    next(item for item in submitted['processes'][0]['types'] if item['name'] == target)['imported'] = True
    with pytest.raises(CatalogueError):
        select_imports(stored, submitted, [])


def test_unimport_used_type_names_affected_plans_including_archived():
    stored = catalogue()
    submitted = deepcopy(stored)
    submitted['processes'][0]['types'][1]['imported'] = False
    entry = {**plan(), 'archived': True}
    with pytest.raises(CatalogueError, match='Platform plan'):
        select_imports(stored, submitted, [entry])


def test_used_process_cannot_lose_all_imports():
    stored = catalogue()
    submitted = deepcopy(stored)
    for item in submitted['processes'][0]['types']:
        item['imported'] = False
    with pytest.raises(CatalogueError, match='Platform plan'):
        select_imports(stored, submitted, [plan()])


def test_import_selection_cannot_forge_server_metadata():
    stored = catalogue()
    submitted = deepcopy(stored)
    submitted['processes'][0]['types'][-1]['backlog_level'] = 'portfolio'
    submitted['processes'][0]['types'][-1]['imported'] = True
    with pytest.raises(CatalogueError):
        select_imports(stored, submitted, [])


def test_sync_initial_backlogs_and_sibling_import_then_remove():
    content = catalogue()
    initial = sync_display(content, {'schema_version': 2, 'process_order': [], 'type_tiers': {}})
    assert initial == {'schema_version': 2, 'process_order': ['agile'],
                       'type_tiers': {'agile': [['Epic'], ['Feature'], ['User Story']]}}
    content['processes'][0]['types'][3]['imported'] = True
    synced = sync_display(content, initial)
    assert synced['type_tiers']['agile'][-1] == ['User Story', 'Bug']
    content['processes'][0]['types'][0]['imported'] = False
    assert sync_display(content, synced)['type_tiers']['agile'] == [
        ['Feature'], ['User Story', 'Bug']]
    for item in content['processes'][0]['types']:
        item['imported'] = False
    assert sync_display(content, synced) == {
        'schema_version': 2, 'process_order': [], 'type_tiers': {}}