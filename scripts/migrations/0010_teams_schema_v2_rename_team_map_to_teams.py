"""Migration: Update teams.yml schema from v1 to v2

Schema v2 changes:
1. Rename "team_map" key to "teams" to match the people database format
2. Add support for optional "exclude" key on team entries
   - Teams marked with exclude=True are not used in operations
   - They help ensure no mismatches between people database and config
   - Admin UI Cost->Inspect Teams will report clean installation

Behavior:
- Reads `data/config/teams.yml` and updates schema_version to 2
- Renames "team_map" to "teams"
- Preserves all team entries and their properties
- Supports `dry_run` to show changes without writing
- Supports `backup` to keep a backup of the original file
"""

MIGRATION_ID = '0010.teams-schema-v2-rename-team-map-to-teams'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    teams_path = cfg_dir / 'teams.yml'

    print(f"Migration {MIGRATION_ID}: updating teams.yml to schema_version 2")
    
    if not teams_path.exists():
        print(f"Teams file not found at {teams_path}; nothing to do.")
        return

    text = teams_path.read_text(encoding='utf8')
    try:
        cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse YAML from {teams_path}: {e}")
        return

    current_version = cfg.get('schema_version', 1)
    
    if current_version >= 2:
        print(f"Teams configuration is already at schema_version {current_version}; nothing to do.")
        return

    if current_version != 1:
        print(f"Warning: Unknown schema_version {current_version}. Expected version 1.")
        print("Proceeding with migration...")

    # Check if we have team_map to migrate
    if 'team_map' not in cfg:
        print("No 'team_map' key found in teams.yml. Adding empty 'teams' list.")
        cfg['teams'] = []
    else:
        # Rename team_map to teams
        print(f"Renaming 'team_map' to 'teams' ({len(cfg.get('team_map', []))} entries)")
        cfg['teams'] = cfg.pop('team_map')

    # Update schema version
    cfg['schema_version'] = 2

    if dry_run:
        print("\nDry-run: teams.yml would be updated to:")
        print(yaml.safe_dump(cfg, sort_keys=False))
        return

    # Backup original if requested
    if backup:
        bak = teams_path.with_suffix(teams_path.suffix + '.bak')
        shutil.copy2(teams_path, bak)
        print(f"Backed up original {teams_path} -> {bak}")

    # Write updated configuration
    teams_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding='utf8')
    print(f"Updated {teams_path} to schema_version 2")
    print(f"✓ Migration complete: 'team_map' renamed to 'teams'")