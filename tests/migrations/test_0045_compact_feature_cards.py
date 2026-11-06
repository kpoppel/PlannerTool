import pytest

from planner_lib.migrations import revisions
from planner_lib.migrations.contracts import schema_state
from planner_lib.migrations.coordinator import Database
from planner_lib.storage.memory_backend import MemoryStorage
from planner_lib.views.view_store import save_user_view


@pytest.mark.parametrize('mode', ['normal', 'compact', 'packed'])
def test_upgrade_replaces_legacy_card_sizes_and_preserves_view_data(mode):
    storage = MemoryStorage()
    original = {'name': 'Saved', 'selectedTeams': {'team': True}, 'viewOptions': {
        'displayMode': mode, 'condensedCards': mode != 'normal',
        'packedMode': mode == 'packed', 'pluginState': {'value': 42},
    }}
    storage.save('views', 'owner_view', original)
    storage.save('views', 'view_register', {'unchanged': True})
    revisions.upgrade_45(storage)
    saved = storage.load('views', 'owner_view')
    assert saved == {**original, 'viewOptions': {**original['viewOptions'],
        'displayMode': 'packed' if mode == 'packed' else 'normal',
        'condensedCards': True, 'packedMode': mode == 'packed'}}
    assert storage.load('views', 'view_register') == {'unchanged': True}
    revisions.upgrade_45(storage)
    assert storage.load('views', 'owner_view') == saved


def test_startup_upgrades_saved_compact_view_from_revision_44(tmp_path):
    owner = '11111111-1111-4111-8111-111111111111'
    handle = Database(tmp_path).prepare()
    handle.storage.save('views', owner + '_view', {'viewOptions': {
        'displayMode': 'compact', 'condensedCards': True, 'packedMode': False,
        'packedModeUnplannedPreference': True,
    }})
    handle.storage.save('system', 'schema_state', schema_state(44, initialized=True))
    handle.close()
    upgraded = Database(tmp_path).prepare()
    try:
        assert upgraded.storage.load('views', owner + '_view')['viewOptions']['displayMode'] == 'normal'
        assert upgraded.storage.load('system', 'schema_state')['schema_revision'] == 45
    finally:
        upgraded.close()


def test_new_views_use_the_new_normal_card_size_and_reject_retired_modes():
    storage = MemoryStorage()
    saved = save_user_view(storage, 'owner', None, {'name': 'New', 'viewOptions': {}})
    options = storage.load('views', 'owner_' + saved['id'])['viewOptions']
    assert options['displayMode'] == 'normal'
    assert options['condensedCards'] is True
    assert options['packedMode'] is False
    with pytest.raises(ValueError, match='displayMode'):
        save_user_view(storage, 'owner', None, {'viewOptions': {'displayMode': 'compact'}})