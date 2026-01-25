"""Migration: split `data/config/server_config.yml` into projects and teams files

Behavior:
- Reads `data/config/server_config.yml` and extracts `project_map` and `team_map` keys.
- Writes `data/config/projects.yml` containing `schema_version: 1` and the
  `project_map` data under the `project_map` key.
- Writes `data/config/teams.yml` containing `schema_version: 1` and the
  `team_map` data under the `team_map` key.
- Removes `project_map` and `team_map` from `server_config.yml` when migration
  is applied.
- Supports `dry_run` to show changes without writing, and `backup` to keep
  a backup of the original `server_config.yml` (and of any overwritten targets).
"""

MIGRATION_ID = '0006.split-server-config-into-projects-teams'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import json
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    cfg_path = cfg_dir / 'server_config.yml'
    projects_path = cfg_dir / 'projects.yml'
    teams_path = cfg_dir / 'teams.yml'

    print(f"Migration {MIGRATION_ID}: splitting server_config into projects and teams files")
    if not cfg_path.exists():
        print(f"Config file not found at {cfg_path}; nothing to do.")
        return

    text = cfg_path.read_text(encoding='utf8')
    try:
        cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse YAML from {cfg_path}: {e}")
        return

    pm = cfg.get('project_map')
    tm = cfg.get('team_map')

    if not pm and not tm:
        print("No 'project_map' or 'team_map' found in server_config.yml; nothing to do.")
        return

    # Show planned actions
    if pm:
        print(f" - Will write project_map -> {projects_path} (entries: {len(pm) if isinstance(pm, list) else 'unknown'})")
    if tm:
        print(f" - Will write team_map -> {teams_path} (entries: {len(tm) if isinstance(tm, list) else 'unknown'})")
    print(f" - Will remove project_map/team_map keys from {cfg_path}")

    if dry_run:
        print("Dry-run: no files will be written.")
        return

    # Ensure config dir exists
    cfg_dir.mkdir(parents=True, exist_ok=True)

    # Backup original server_config if requested
    if backup:
        bak = cfg_path.with_suffix(cfg_path.suffix + '.bak')
        shutil.copy2(cfg_path, bak)
        print(f"Backed up original {cfg_path} -> {bak}")

    # Write projects.yml if needed
    if pm:
        # if target exists, back it up if requested, else avoid overwriting silently
        if projects_path.exists():
            if backup:
                bakp = projects_path.with_suffix(projects_path.suffix + '.bak')
                shutil.copy2(projects_path, bakp)
                print(f"Backed up existing {projects_path} -> {bakp}")
            else:
                print(f"Target {projects_path} already exists; skipping write (use backup=True to preserve).")
        else:
            out = {'schema_version': 1, 'project_map': pm}
            projects_path.write_text(yaml.safe_dump(out, sort_keys=False), encoding='utf8')
            print(f"Wrote {projects_path}")

    # Write teams.yml if needed
    if tm:
        if teams_path.exists():
            if backup:
                bakt = teams_path.with_suffix(teams_path.suffix + '.bak')
                shutil.copy2(teams_path, bakt)
                print(f"Backed up existing {teams_path} -> {bakt}")
            else:
                print(f"Target {teams_path} already exists; skipping write (use backup=True to preserve).")
        else:
            out = {'schema_version': 1, 'team_map': tm}
            teams_path.write_text(yaml.safe_dump(out, sort_keys=False), encoding='utf8')
            print(f"Wrote {teams_path}")

    # Remove the keys from server_config and write it back
    cfg.pop('project_map', None)
    cfg.pop('team_map', None)
    cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding='utf8')
    print(f"Updated {cfg_path} with project_map/team_map removed")
