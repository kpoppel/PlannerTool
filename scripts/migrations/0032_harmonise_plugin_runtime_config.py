"""Migration: harmonise plugin startup activation and menu placement."""

MIGRATION_ID = '0031.harmonise-plugin-runtime-config'


def migrate_config(payload, menu_positions):
    from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config

    if isinstance(payload, dict) and payload.get('schema_version') == 2:
        entries = payload['plugins']
        if all('activated' not in entry and 'order' not in entry for entry in entries):
            return normalize_plugin_runtime_config(payload)
    if isinstance(payload, list):
        entries = payload
    elif isinstance(payload, dict):
        entries = payload['plugins']
    else:
        raise ValueError('plugin runtime config must be an object or legacy array')

    migrated = []
    for entry in entries:
        plugin_id = entry['id']
        result = {
            'id': plugin_id,
            'enabled': entry.get('enabled', True),
            'activateOnStartup': entry.get('activated', False),
            'custom_config': entry.get('custom_config', {}),
        }
        if plugin_id in menu_positions:
            result['activateOnStartup'] = False
            result['menuPosition'] = entry.get('menuPosition', menu_positions[plugin_id])
        migrated.append(result)
    return normalize_plugin_runtime_config({'schema_version': 2, 'plugins': migrated})


def upgrade(dry_run=False, backup=False):
    import json
    from pathlib import Path
    import sys

    root = Path(__file__).resolve().parents[2]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    cache_dir = root / 'data' / 'cache'
    if not cache_dir.exists():
        return

    with (root / 'www' / 'js' / 'modules.config.json').open() as source:
        modules = json.load(source)['modules']
    menu_positions = {module['id']: module['menuPosition'] for module in modules if module['type'] == 'menu'}
    storage = DiskCacheStorage(str(cache_dir))
    try:
        if not storage.exists('config', 'plugin_runtime_config'):
            return
        original = storage.load('config', 'plugin_runtime_config')
        migrated = migrate_config(original, menu_positions)
        if migrated == original:
            return
        if dry_run:
            print('Would migrate plugin runtime config to schema v2')
            return
        if backup:
            storage.save('config_backup', 'plugin_runtime_config_before_v2', original)
        storage.save('config', 'plugin_runtime_config', migrated)
    finally:
        storage.close()