"""Clean up stale fields in ado_config (diskcache) and server_config.yml.

Two housekeeping tasks introduced when the Data Sources admin panel replaced
the separate AzureDevOps panel and the MemoryCacheManager was removed.

Task A — ado_config: set the explicit backend type-selector flag
----------------------------------------------------------------
The old AzureDevOps admin panel (SchemaForm-based) wrote backend-selection
boolean flags (use_azure_mock, use_azure_mock_generator, use_static_backend)
directly in server_config.feature_flags, which migration 0021 then copied into
ado_config.feature_flags.  However, if the server config was written by the
old panel *after* migration 0021 ran, the type-selector flags might be absent
from ado_config while generator_config / azure_mock_data_dir sub-config keys
are present.  The new Data Sources panel derives the backend type purely from
the explicit boolean flags (BackendRegistry.get_active_class contract), so the
correct flag must be present.

Inference rules (same priority as BackendRegistry._priority_backends):
  1. use_static_backend    — already set        → leave as-is
  2. use_azure_mock_generator — already set     → leave as-is
  3. use_azure_mock           — already set     → leave as-is
  4. static_data_path (non-empty)               → set use_static_backend
  5. generator_persist_enabled OR non-empty     → set use_azure_mock_generator
     generator_config
  6. azure_mock_persist_enabled AND             → set use_azure_mock
     azure_mock_data_dir (non-empty)
  Otherwise: no flag set → live ADO (correct default, nothing to do)

Task B — server_config.yml: remove stale MemoryCacheManager keys
-----------------------------------------------------------------
MemoryCacheManager was removed when diskcache replaced it (migration 0016 added
the config; the manager itself was later deleted).  Two stale entries remain in
server_config.yml on installations that last wrote the file before the manager
was removed:

  memory_cache:           (top-level mapping)
  feature_flags.enable_memory_cache: (boolean flag)

These are no longer read by any code path and should be pruned.

Behaviour
---------
- Idempotent: skips each task silently when there is nothing to change.
- dry_run=True prints planned changes without writing anything.
- backup=True copies server_config.yml to a timestamped .bak file before
  writing (matches the convention used by migration 0021).
"""

MIGRATION_ID = '0023.clean-ado-config-and-server-config'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import sys
    import yaml

    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))

    try:
        from planner_lib.storage import create_storage
    except ImportError as e:
        print(f'Migration {MIGRATION_ID}: failed to import planner_lib: {e}')
        raise

    cache_dir  = root / 'data' / 'cache'
    config_dir = root / 'data' / 'config'

    storage = create_storage(
        backend='diskcache',
        serializer='raw',
        data_dir=str(cache_dir),
    )

    # ------------------------------------------------------------------
    # Task A: ensure ado_config has an explicit backend type-selector flag
    # ------------------------------------------------------------------
    _fix_ado_backend_type(storage, dry_run)

    # ------------------------------------------------------------------
    # Task B: prune stale MemoryCacheManager keys from server_config.yml
    # ------------------------------------------------------------------
    _prune_server_config(config_dir, dry_run, backup)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _fix_ado_backend_type(storage, dry_run):
    """Set a missing backend type-selector flag in ado_config.feature_flags."""
    label = f'Migration {MIGRATION_ID} [ado_config]'

    try:
        ado_cfg = storage.load('config', 'ado_config') or {}
    except (KeyError, Exception):
        print(f'{label}: SKIP — ado_config not found in diskcache')
        return

    flags = dict(ado_cfg.get('feature_flags') or {})

    # Already has an explicit selector → nothing to do
    if flags.get('use_static_backend') or flags.get('use_azure_mock_generator') or flags.get('use_azure_mock'):
        print(f'{label}: OK — explicit backend type-selector already present')
        return

    # Infer the intended backend from sub-config keys
    inferred_flag = None
    if flags.get('static_data_path'):
        inferred_flag = 'use_static_backend'
    elif flags.get('generator_persist_enabled') or (
        isinstance(flags.get('generator_config'), dict) and flags['generator_config']
    ):
        inferred_flag = 'use_azure_mock_generator'
    elif flags.get('azure_mock_persist_enabled') and flags.get('azure_mock_data_dir'):
        inferred_flag = 'use_azure_mock'

    if inferred_flag is None:
        print(f'{label}: OK — no sub-config present; live ADO is the correct default (no flag needed)')
        return

    if dry_run:
        print(f'{label}: DRY — would set feature_flags.{inferred_flag} = true in ado_config')
        return

    flags[inferred_flag] = True
    updated = dict(ado_cfg)
    updated['feature_flags'] = flags
    storage.save('config', 'ado_config', updated)
    print(f'{label}: set feature_flags.{inferred_flag} = true')


def _prune_server_config(config_dir, dry_run, backup):
    """Remove stale memory_cache keys from server_config.yml."""
    import yaml

    label = f'Migration {MIGRATION_ID} [server_config]'
    server_config_path = config_dir / 'server_config.yml'

    if not server_config_path.exists():
        print(f'{label}: SKIP — server_config.yml not found')
        return

    try:
        cfg = yaml.safe_load(server_config_path.read_text(encoding='utf-8')) or {}
    except yaml.YAMLError as exc:
        print(f'{label}: ERROR — failed to parse server_config.yml: {exc}')
        raise

    changed = False

    # Remove top-level memory_cache block
    if 'memory_cache' in cfg:
        if dry_run:
            print(f'{label}: DRY — would remove top-level memory_cache block')
        else:
            del cfg['memory_cache']
        changed = True

    # Remove feature_flags.enable_memory_cache
    feature_flags = cfg.get('feature_flags') or {}
    if 'enable_memory_cache' in feature_flags:
        if dry_run:
            print(f'{label}: DRY — would remove feature_flags.enable_memory_cache')
        else:
            del feature_flags['enable_memory_cache']
            cfg['feature_flags'] = feature_flags
        changed = True

    if not changed:
        print(f'{label}: OK — no stale MemoryCacheManager keys found')
        return

    if dry_run:
        return  # messages already printed above

    if backup:
        import shutil
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        bak_path = server_config_path.with_name(f'server_config_backup_{ts}.yml')
        shutil.copy2(server_config_path, bak_path)
        print(f'{label}: backed up server_config.yml → {bak_path.name}')

    server_config_path.write_text(
        yaml.dump(cfg, default_flow_style=False, sort_keys=True, indent=2),
        encoding='utf-8',
    )
    print(f'{label}: server_config.yml updated (stale MemoryCacheManager keys removed)')
