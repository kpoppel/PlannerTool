"""Tests for migration 0029: move saved-view expansion flags into Context."""
import importlib.util
from pathlib import Path

from planner_lib.storage.diskcache_backend import DiskCacheStorage


MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / 'scripts'
    / 'migrations'
    / '0029_migrate_view_expansion_to_context.py'
)


def _load_migration(tmp_path):
    spec = importlib.util.spec_from_file_location('migration_0029', MIGRATION_PATH)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration._root = tmp_path
    return migration


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

    migration = _load_migration(tmp_path)
    migration.upgrade()

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


def test_upgrade_dry_run_does_not_change_saved_view(tmp_path):
    _seed_legacy_view(tmp_path)
    before = _load_view(tmp_path)

    migration = _load_migration(tmp_path)
    migration.upgrade(dry_run=True)

    assert _load_view(tmp_path) == before
