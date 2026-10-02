"""Tests for migration 0029: move saved-view expansion flags into Context."""

from planner_lib.migrations.revisions import upgrade_29
from planner_lib.storage.diskcache_backend import DiskCacheStorage


def _upgrade_view(tmp_path):
    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    try:
        upgrade_29(storage)
    finally:
        storage.close()


def _seed_legacy_view(tmp_path):
    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    storage.save('views', 'view_register', {
        'user@example.com_cost': {
            'id': 'cost',
            'user': 'user@example.com',
            'name': 'Cost view',
        },
    })
    storage.save('views', 'user@example.com_cost', {
        'name': 'Cost view',
        'viewOptions': {
            'expandParentChild': True,
            'expandRelations': False,
            'expandTeamAllocated': True,
            'context': {
                'parent': False,
                'dependency': True,
            },
            'timelineScale': 'months',
        },
    })
    storage.close()


def _load_view(tmp_path):
    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    value = storage.load('views', 'user@example.com_cost')
    storage.close()
    return value


def test_upgrade_migrates_expansion_to_context_and_removes_legacy_keys(tmp_path):
    _seed_legacy_view(tmp_path)

    _upgrade_view(tmp_path)

    view = _load_view(tmp_path)
    options = view['viewOptions']
    assert options['context'] == {
        'parent': True,
        'child': True,
        'dependency': True,
        'otherAllocations': True,
    }
    assert options['timelineScale'] == 'months'
    assert 'expandParentChild' not in options
    assert 'expandRelations' not in options
    assert 'expandTeamAllocated' not in options


def test_upgrade_is_idempotent(tmp_path):
    _seed_legacy_view(tmp_path)
    _upgrade_view(tmp_path)
    before = _load_view(tmp_path)

    _upgrade_view(tmp_path)

    assert _load_view(tmp_path) == before
