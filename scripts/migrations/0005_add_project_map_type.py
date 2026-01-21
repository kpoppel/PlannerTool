"""Migration: Add `type` to `project_map` entries in server_config.yml

Behavior:
- Ensures each entry under `data/config/server_config.yml` -> `project_map`
  has a `type` field. If missing, sets it to the default value `project`.
- Supports `dry_run` to show changes without writing, and `backup` to keep
  a backup of the original config file.
"""

MIGRATION_ID = '0005.add-project-map-type'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import json

    root = Path(__file__).resolve().parents[2]
    cfg_path = root / 'data' / 'config' / 'server_config.yml'

    print(f"Migration {MIGRATION_ID}: ensuring project_map entries have a 'type' field")
    if not cfg_path.exists():
        print(f"Config file not found at {cfg_path}; nothing to do.")
        return

    text = cfg_path.read_text(encoding='utf8')
    try:
        cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse YAML: {e}")
        return

    pm = cfg.get('project_map')
    if not pm or not isinstance(pm, list):
        print("No project_map list found or it's empty; nothing to do.")
        return

    changed = False
    for entry in pm:
        if not isinstance(entry, dict):
            continue
        if 'type' not in entry:
            entry['type'] = 'project'
            changed = True

    if not changed:
        print("All entries already have a 'type' field; nothing to change.")
        return

    if dry_run:
        print("Dry-run: the following changes would be applied to project_map entries:")
        for e in pm:
            print(json.dumps(e, ensure_ascii=False))
        return

    # Write backup if requested
    if backup:
        bak = cfg_path.with_suffix(cfg_path.suffix + '.bak')
        cfg_path.rename(bak)
        print(f"Backed up original config to {bak}")

    # Write updated config
    out = yaml.safe_dump(cfg, sort_keys=False)
    cfg_path.write_text(out, encoding='utf8')
    print(f"Updated {cfg_path} with 'type' field on project_map entries")
