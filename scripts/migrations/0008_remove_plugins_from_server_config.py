"""Migration: remove `plugins` map from `data/config/server_config.yml`

Behavior:
- If `plugins` key exists in `data/config/server_config.yml`, remove it.
- Supports `dry_run` to show changes without writing, and `backup` to keep a
  backup of the original file when changes are applied.
"""

MIGRATION_ID = '0008.remove-plugins-from-server-config'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import json

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    cfg_file = cfg_dir / 'server_config.yml'

    print(f"Migration {MIGRATION_ID}: remove 'plugins' map from {cfg_file}")

    if not cfg_file.exists():
        print(f"Config file not found at {cfg_file}; nothing to do.")
        return

    text = cfg_file.read_text(encoding='utf8')
    try:
        cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse {cfg_file}: {e}")
        return

    if 'plugins' not in cfg:
        print("No 'plugins' key present; nothing to do.")
        # Even if plugins missing, ensure schema_version is set to 2
        if cfg.get('schema_version') != 2:
            print("Will set 'schema_version' to 2")
            cfg['schema_version'] = 2
        else:
            return

    else:
        # Remove the plugins mapping
        cfg.pop('plugins', None)
        # Ensure schema_version is set to 2
        if cfg.get('schema_version') != 2:
            cfg['schema_version'] = 2

    if dry_run:
        print("Dry-run: the following server_config.yml would be written:")
        print(json.dumps(cfg, ensure_ascii=False, indent=2))
        return

    # Backup original if requested
    if backup:
        bak = cfg_file.with_suffix(cfg_file.suffix + '.bak')
        cfg_file.rename(bak)
        print(f"Backed up original config to {bak}")

    out = yaml.safe_dump(cfg, sort_keys=False)
    cfg_file.write_text(out, encoding='utf8')
    print(f"Updated {cfg_file}: removed 'plugins' key")
