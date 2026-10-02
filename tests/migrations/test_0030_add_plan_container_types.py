from planner_lib.migrations.revisions import upgrade_30
from planner_lib.storage.diskcache_backend import DiskCacheStorage


def test_upgrades_existing_projects_without_changing_plan_metadata(tmp_path):
    root = tmp_path / 'installation'
    cache_dir = root / 'data/cache'
    cache_dir.mkdir(parents=True)
    original = {'project_map': [{'name': 'Alpha', 'type': 'team'}]}
    storage = DiskCacheStorage(cache_dir)
    try:
        storage.save('config', 'projects', original)
        upgrade_30(storage)
        upgrade_30(storage)
        assert storage.load('config', 'projects') == {
            **original, 'container_types': ['project', 'team'],
        }
        assert not storage.exists('config_backup', 'projects_before_containers')
    finally:
        storage.close()