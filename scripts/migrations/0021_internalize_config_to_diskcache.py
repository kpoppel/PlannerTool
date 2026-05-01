"""Internalize YAML config files into diskcache.

Moves the following YAML configuration files from ``data/config/`` into the
diskcache store (``data/cache/``) under the ``config`` namespace so that
ConfigBackend operates directly on diskcache — a peer of UserDataBackend:

  area_plan_map.yml  → config::area_plan_map
  cost_config.yml    → config::cost_config
  global_settings.yml → config::global_settings
  iterations.yml     → config::iterations
  projects.yml       → config::projects
  teams.yml          → config::teams

Additionally extracts ADO-specific settings from ``server_config.yml`` into a
new ``config::ado_config`` key, and prunes those fields from
``server_config.yml`` so it contains only generic server settings.

Extracted ADO fields
---------------------
  azure_devops_organization → ado_config.organization_url
  feature_flags.use_azure_mock
  feature_flags.use_azure_mock_generator
  feature_flags.azure_mock_persist_enabled
  feature_flags.generator_config
  feature_flags.generator_persist_enabled

The resulting ``ado_config`` shape:
  {
    "organization_url": "<org>",
    "feature_flags": {
      "use_azure_mock": ...,
      "use_azure_mock_generator": ...,
      "azure_mock_persist_enabled": ...,
      "generator_config": {...},
      "generator_persist_enabled": ...
    }
  }

Behaviour
---------
- Idempotent: each config key is written to diskcache only if it does not
  already exist there, allowing the migration to be re-run safely.
- ``ado_config`` extraction is skipped when it already exists in diskcache.
- YAML files are preserved on disk (not deleted); they become stale archives.
- ``backup=True`` copies ``server_config.yml`` to a timestamped ``.bak``
  before the pruning write.
- ``dry_run=True`` prints planned actions without writing anything.

Requirements
------------
- Python packages: ``diskcache``, ``pyyaml`` (both in requirements.txt).
- Must be run while the server is stopped to avoid cache-consistency races.
"""

MIGRATION_ID = '0021.internalize-config-to-diskcache'

# YAML config keys to migrate (filename stem → diskcache key)
_CONFIG_KEYS = [
    'area_plan_map',
    'cost_config',
    'global_settings',
    'iterations',
    'projects',
    'teams',
]

# ADO-specific feature-flag keys extracted from server_config.feature_flags
_ADO_FLAG_KEYS = [
    'use_azure_mock',
    'use_azure_mock_generator',
    'azure_mock_persist_enabled',
    'generator_config',
    'generator_persist_enabled',
]


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

    config_dir = root / 'data' / 'config'
    cache_dir = root / 'data' / 'cache'

    storage = create_storage(
        backend='diskcache',
        serializer='raw',
        data_dir=str(cache_dir),
    )

    # ------------------------------------------------------------------
    # 1. Migrate YAML config files → diskcache
    # ------------------------------------------------------------------
    print(f'Migration {MIGRATION_ID}: migrating YAML config files to diskcache')

    for key in _CONFIG_KEYS:
        yaml_path = config_dir / f'{key}.yml'

        if not yaml_path.exists():
            print(f'  SKIP  {key}: {yaml_path} not found')
            continue

        if storage.exists('config', key):
            print(f'  SKIP  {key}: already present in diskcache (idempotent)')
            continue

        try:
            data = yaml.safe_load(yaml_path.read_text(encoding='utf-8'))
        except yaml.YAMLError as exc:
            print(f'  ERROR {key}: failed to parse YAML — {exc}')
            raise

        if dry_run:
            print(f'  DRY   {key}: would write {_size_hint(data)} to diskcache')
        else:
            storage.save('config', key, data)
            print(f'  OK    {key}: written to diskcache')

    # ------------------------------------------------------------------
    # 2. Extract ADO config from server_config.yml
    # ------------------------------------------------------------------
    server_config_path = config_dir / 'server_config.yml'

    if not server_config_path.exists():
        print(f'Migration {MIGRATION_ID}: server_config.yml not found — skipping ADO extraction')
        return

    try:
        server_cfg = yaml.safe_load(server_config_path.read_text(encoding='utf-8')) or {}
    except yaml.YAMLError as exc:
        print(f'Migration {MIGRATION_ID}: failed to parse server_config.yml — {exc}')
        raise

    if storage.exists('config', 'ado_config'):
        print(f'Migration {MIGRATION_ID}: ado_config already in diskcache — skipping extraction (idempotent)')
        return

    org_url = server_cfg.get('azure_devops_organization') or ''
    feature_flags = dict(server_cfg.get('feature_flags') or {})

    ado_flags = {}
    for flag in _ADO_FLAG_KEYS:
        if flag in feature_flags:
            ado_flags[flag] = feature_flags.pop(flag)

    ado_config = {
        'organization_url': org_url,
        'feature_flags': ado_flags,
    }

    if dry_run:
        print(f'Migration {MIGRATION_ID}: DRY — would write ado_config to diskcache: {ado_config}')
        print(f'Migration {MIGRATION_ID}: DRY — would prune server_config.yml '
              f'(remove azure_devops_organization + {list(ado_flags.keys())})')
        return

    # Write ado_config to diskcache
    storage.save('config', 'ado_config', ado_config)
    print(f'Migration {MIGRATION_ID}: ado_config written to diskcache '
          f'(org={org_url!r}, flags={list(ado_flags.keys())})')

    # Prune server_config.yml
    pruned_cfg = dict(server_cfg)
    pruned_cfg.pop('azure_devops_organization', None)
    pruned_cfg['feature_flags'] = feature_flags  # already had ADO flags removed

    if backup:
        import shutil
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        bak_path = server_config_path.with_name(f'server_config_backup_{ts}.yml')
        shutil.copy2(server_config_path, bak_path)
        print(f'Migration {MIGRATION_ID}: backed up server_config.yml → {bak_path.name}')

    server_config_path.write_text(
        yaml.dump(pruned_cfg, default_flow_style=False, sort_keys=False, indent=2),
        encoding='utf-8',
    )
    print(f'Migration {MIGRATION_ID}: server_config.yml pruned (ADO fields removed)')


def _size_hint(data) -> str:
    """Return a human-readable size hint for logging."""
    if isinstance(data, dict):
        return f'dict({len(data)} top-level keys)'
    if isinstance(data, list):
        return f'list({len(data)} items)'
    return type(data).__name__
