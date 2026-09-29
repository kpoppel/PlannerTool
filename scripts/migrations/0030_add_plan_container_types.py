"""Migration: add an ordered plan container hierarchy to projects config."""

MIGRATION_ID = '0030.add-plan-container-types'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import sys

    root = Path(__file__).resolve().parents[2]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    cache_dir = root / 'data' / 'cache'
    if not cache_dir.exists():
        return

    storage = DiskCacheStorage(str(cache_dir))
    try:
        if not storage.exists('config', 'projects'):
            return
        config = storage.load('config', 'projects')
        if 'container_types' in config:
            return
        migrated = {**config, 'container_types': ['project', 'team']}
        if dry_run:
            print('Would add project -> team plan container hierarchy')
            return
        if backup:
            storage.save('config_backup', 'projects_before_containers', config)
        storage.save('config', 'projects', migrated)
    finally:
        storage.close()