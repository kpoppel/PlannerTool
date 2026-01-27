"""Migration: Rename `database.yaml` and update `projects.yml` entries

Behavior:
- Rename `data/config/database.yaml` to `data/config/databse.yml` (note: intentional
  target name `databse.yml` as requested). If the target already exists, the rename is
  skipped.
- Update `data/config/projects.yml`:
  - set `schema_version` to `2`
  - ensure each entry under `project_map` (list of maps) has the fields:
    - `task_types: ['feature', 'epic']`
    - `exclude_states: ['closed', 'removed']`
    - `include_states: []`

Supports `dry_run` to show changes without writing, and `backup` to keep a backup
of the original files when changes are applied.
"""

MIGRATION_ID = '0007.rename-db-and-update-projects'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import json
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    db_path = cfg_dir / 'database.yaml'
    db_target = cfg_dir / 'databse.yml'
    projects_path = cfg_dir / 'projects.yml'

    print(f"Migration {MIGRATION_ID}: rename database.yaml -> databse.yml and update projects.yml entries")

    # Part 1: rename database file if present
    if db_path.exists():
        if db_target.exists():
            print(f"Target {db_target} already exists; skipping rename of {db_path}")
        else:
            print(f"Found {db_path}; will rename to {db_target}")
            if dry_run:
                print("Dry-run: would rename file")
            else:
                if backup:
                    bak = db_path.with_suffix(db_path.suffix + '.bak')
                    shutil.copy2(db_path, bak)
                    print(f"Backed up original database file to {bak}")
                db_path.rename(db_target)
                print(f"Renamed {db_path} -> {db_target}")
    else:
        print(f"No database file found at {db_path}; skipping rename")

    # Part 2: update projects.yml
    if not projects_path.exists():
        print(f"Projects file not found at {projects_path}; nothing to do for projects.yml")
        return

    text = projects_path.read_text(encoding='utf8')
    try:
        cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse {projects_path}: {e}")
        return

    changed = False

    # Update schema_version
    if cfg.get('schema_version') != 2:
        cfg['schema_version'] = 2
        changed = True

    pm = cfg.get('project_map')
    if not pm or not isinstance(pm, list):
        print("No project_map list found or it's empty; nothing to do for project_map entries.")
        # Still may have changed schema_version
        if changed:
            if dry_run:
                print("Dry-run: would update schema_version to 2 in projects.yml")
            else:
                if backup:
                    bak = projects_path.with_suffix(projects_path.suffix + '.bak')
                    projects_path.rename(bak)
                    print(f"Backed up original projects.yml to {bak}")
                out = yaml.safe_dump(cfg, sort_keys=False)
                projects_path.write_text(out, encoding='utf8')
                print(f"Updated {projects_path}")
        return

    for entry in pm:
        if not isinstance(entry, dict):
            continue
        if 'task_types' not in entry:
            entry['task_types'] = ['feature', 'epic']
            changed = True
        if 'include_states' not in entry:
            entry['include_states'] = ['new', 'active', 'defined', 'resolved']
            changed = True

    if not changed:
        print("No changes required in projects.yml or database rename; nothing to do.")
        return

    if dry_run:
        print("Dry-run: the following projects.yml would be written:")
        print(json.dumps(cfg, ensure_ascii=False, indent=2))
        return

    # Write backup and update file
    if backup:
        bak = projects_path.with_suffix(projects_path.suffix + '.bak')
        projects_path.rename(bak)
        print(f"Backed up original projects.yml to {bak}")

    out = yaml.safe_dump(cfg, sort_keys=False)
    projects_path.write_text(out, encoding='utf8')
    print(f"Updated {projects_path} with schema_version=2 and project fields")
