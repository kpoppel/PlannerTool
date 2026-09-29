import importlib.util
from pathlib import Path

from planner_lib.storage.diskcache_backend import DiskCacheStorage


def test_upgrades_existing_projects_without_changing_plan_metadata(tmp_path):
    migration_path = Path(__file__).resolve().parents[2] / 'scripts/migrations/0030_add_plan_container_types.py'
    spec = importlib.util.spec_from_file_location('migration_0030', migration_path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    root = tmp_path / 'installation'
    cache_dir = root / 'data/cache'
    cache_dir.mkdir(parents=True)
    migration.__file__ = str(root / 'scripts/migrations/0030_add_plan_container_types.py')
    original = {'project_map': [{'name': 'Alpha', 'type': 'team'}]}
    storage = DiskCacheStorage(cache_dir)
    storage.save('config', 'projects', original)
    storage.close()

    migration.upgrade(dry_run=True)
    storage = DiskCacheStorage(cache_dir)
    assert storage.load('config', 'projects') == original
    storage.close()

    migration.upgrade(backup=True)
    migration.upgrade()
    storage = DiskCacheStorage(cache_dir)
    assert storage.load('config', 'projects') == {
        **original, 'container_types': ['project', 'team'],
    }
    assert storage.load('config_backup', 'projects_before_containers') == original
    storage.close()