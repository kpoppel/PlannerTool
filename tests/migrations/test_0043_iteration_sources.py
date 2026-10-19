from planner_lib.migrations.revisions import upgrade_43
from planner_lib.storage.memory_backend import MemoryStorage


def test_upgrade_preserves_ado_identity_dates_and_selection() -> None:
    storage = MemoryStorage()
    storage.save('config', 'iterations', {'iteration_sets': [{
        'id': 'old-set', 'name': 'Release', 'source_project': 'ADO',
        'root_path': 'Release', 'cached_at': '2026-10-19T00:00:00Z',
        'values': [
            {'path': 'ADO\\Release', 'name': 'Release'},
            {'path': 'ADO\\Release\\One', 'name': 'One',
             'startDate': '2026-10-19T00:00:00Z', 'finishDate': '2026-11-01T00:00:00Z'},
        ],
    }]})
    upgrade_43(storage)
    saved = storage.load('config', 'iterations')['iteration_sets'][0]
    assert saved['id'] == 'old-set'
    assert saved['source_type'] == 'ado'
    assert saved['source_project'] == 'ADO'
    assert saved['selected_paths'] == ['ADO\\Release', 'ADO\\Release\\One']
    assert saved['generator'] is None
    assert saved['values'] == [{'path': 'ADO\\Release\\One', 'name': 'One',
                               'startDate': '2026-10-19', 'finishDate': '2026-11-01'}]


def test_upgrade_initializes_missing_iteration_configuration() -> None:
    storage = MemoryStorage()
    upgrade_43(storage)
    assert storage.load('config', 'iterations') == {'iteration_sets': []}