from uuid import UUID

import pytest

from planner_lib.migrations.contracts import SchemaError
from planner_lib.migrations.revisions import initialize, upgrade_34, validate_records
from planner_lib.storage.diskcache_backend import DiskCacheStorage
from planner_lib.views.view_store import save_user_view


@pytest.fixture
def storage(tmp_path):
    backend = DiskCacheStorage(tmp_path / 'cache')
    initialize(backend)
    backend.save('config', 'projects', {'schema_version': 3, 'project_map': [],
                                      'container_types': ['project', 'team']})
    backend.save('config', 'people', {'schema_version': 1, 'database': {'people': []}})
    yield backend
    backend.close()


@pytest.mark.parametrize('packed', [True, False])
@pytest.mark.parametrize('unplanned', [True, False])
def test_migrates_saved_preference_and_preserves_other_view_data(storage, packed, unplanned):
    key = '11111111-1111-4111-8111-111111111111_view'
    view = {'name': 'Saved', 'selectedTeams': {'team': True}, 'viewOptions': {
        'displayMode': 'packed' if packed else 'normal',
        'taskFilters': {'schedule': {'planned': True, 'unplanned': unplanned}},
        'pluginState': {'plugin': {'value': 42}},
    }}
    storage.save('views', key, view)
    upgrade_34(storage)
    upgraded = storage.load('views', key)
    assert upgraded['viewOptions']['packedModeUnplannedPreference'] is unplanned
    assert upgraded['viewOptions']['taskFilters']['schedule']['unplanned'] is (False if packed else unplanned)
    assert upgraded['viewOptions']['pluginState'] == view['viewOptions']['pluginState']
    assert upgraded['selectedTeams'] == view['selectedTeams']
    assert 'packedModeUnplannedPreference' not in view['viewOptions']
    upgrade_34(storage)
    assert storage.load('views', key) == upgraded
    validate_records(storage, 34)


def test_requires_preference_only_at_the_new_revision(storage):
    key = '11111111-1111-4111-8111-111111111111_view'
    storage.save('views', key, {'viewOptions': {}})
    validate_records(storage, 33)
    with pytest.raises(SchemaError):
        validate_records(storage, 34)
    upgrade_34(storage)
    validate_records(storage, 34)
    view = storage.load('views', key)
    view['viewOptions']['packedModeUnplannedPreference'] = 1
    storage.save('views', key, view)
    with pytest.raises(SchemaError):
        validate_records(storage, 34)


def test_new_view_writes_are_canonical_without_mutating_request(storage):
    owner = str(UUID('11111111-1111-4111-8111-111111111111'))
    payload = {'name': 'New', 'viewOptions': {}}
    saved = save_user_view(storage, owner, None, payload)
    view = storage.load('views', owner + '_' + saved['id'])
    assert view['viewOptions']['packedModeUnplannedPreference'] is True
    assert payload == {'name': 'New', 'viewOptions': {}}