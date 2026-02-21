"""Migration: Move database_path from server_config to people config

This migration:
1. Creates a new config/people.yml file with schema_version 1
2. Moves the database_path from server_config.yml to database_file in people.yml
3. Removes database_path from server_config.yml

Behavior:
- If database_path exists in server_config.yml, create people.yml with that value
- If database_path doesn't exist, create people.yml with default: config/database.yaml
- Remove database_path from server_config.yml after migration
- Supports `dry_run` to show changes without writing
- Supports `backup` to keep backups of original files
"""

MIGRATION_ID = '0011.move-database-path-to-people-config'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    server_config_path = cfg_dir / 'server_config.yml'
    people_config_path = cfg_dir / 'people.yml'

    print(f"Migration {MIGRATION_ID}: move database_path to people configuration")
    
    # Load server_config
    server_cfg = {}
    database_path = None
    
    if server_config_path.exists():
        text = server_config_path.read_text(encoding='utf8')
        try:
            server_cfg = yaml.safe_load(text) or {}
            database_path = server_cfg.get('database_path')
        except Exception as e:
            print(f"Failed to parse {server_config_path}: {e}")
            return
    else:
        print(f"Server config not found at {server_config_path}; skipping server_config update")
    
    # Determine the database_file value for people.yml
    if database_path:
        print(f"Found database_path in server_config: {database_path}")
        database_file = database_path
    else:
        print("No database_path in server_config; using default: config/database.yaml")
        database_file = "config/database.yaml"
    
    # Check if people.yml already exists
    if people_config_path.exists():
        print(f"People config already exists at {people_config_path}")
        # Load and check if we need to update it
        text = people_config_path.read_text(encoding='utf8')
        try:
            people_cfg = yaml.safe_load(text) or {}
            if people_cfg.get('schema_version') == 1:
                print("People config is already at schema_version 1")
                # Still remove database_path from server_config if present
                if database_path and server_config_path.exists():
                    print("Removing database_path from server_config.yml")
                    server_cfg.pop('database_path', None)
                    if not dry_run:
                        if backup:
                            bak = server_config_path.with_suffix(server_config_path.suffix + '.bak')
                            shutil.copy2(server_config_path, bak)
                            print(f"Backed up {server_config_path} -> {bak}")
                        server_config_path.write_text(yaml.safe_dump(server_cfg, sort_keys=False), encoding='utf8')
                        print(f"Updated {server_config_path}: removed 'database_path'")
                return
        except Exception as e:
            print(f"Failed to parse existing people config: {e}")
            return
    
    # Create new people.yml
    people_cfg = {
        'schema_version': 1,
        'database_file': database_file,
        'database': {
            'people': []
        }
    }
    
    if dry_run:
        print("\nDry-run: would create people.yml with:")
        print(yaml.safe_dump(people_cfg, sort_keys=False))
        
        if database_path:
            print("\nDry-run: would update server_config.yml to remove 'database_path':")
            server_cfg_copy = dict(server_cfg)
            server_cfg_copy.pop('database_path', None)
            print(yaml.safe_dump(server_cfg_copy, sort_keys=False))
        return
    
    # Backup and create people.yml
    if backup and people_config_path.exists():
        bak = people_config_path.with_suffix(people_config_path.suffix + '.bak')
        shutil.copy2(people_config_path, bak)
        print(f"Backed up {people_config_path} -> {bak}")
    
    people_config_path.write_text(yaml.safe_dump(people_cfg, sort_keys=False), encoding='utf8')
    print(f"Created {people_config_path}")
    print(f"  schema_version: 1")
    print(f"  database_file: {database_file}")
    
    # Remove database_path from server_config if it exists
    if database_path and server_config_path.exists():
        server_cfg.pop('database_path', None)
        
        if backup:
            bak = server_config_path.with_suffix(server_config_path.suffix + '.bak')
            shutil.copy2(server_config_path, bak)
            print(f"Backed up {server_config_path} -> {bak}")
        
        server_config_path.write_text(yaml.safe_dump(server_cfg, sort_keys=False), encoding='utf8')
        print(f"Updated {server_config_path}: removed 'database_path'")
    
    print(f"✓ Migration complete: database_path moved to people.yml")


def downgrade(dry_run=False, backup=False):
    """Revert the migration by moving database_file back to database_path."""
    from pathlib import Path
    import yaml
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    server_config_path = cfg_dir / 'server_config.yml'
    people_config_path = cfg_dir / 'people.yml'

    print(f"Migration {MIGRATION_ID} downgrade: move database_file back to server_config")
    
    # Load people.yml
    if not people_config_path.exists():
        print(f"People config not found at {people_config_path}; nothing to downgrade")
        return
    
    text = people_config_path.read_text(encoding='utf8')
    try:
        people_cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse {people_config_path}: {e}")
        return
    
    database_file = people_cfg.get('database_file', 'config/database.yaml')
    print(f"Found database_file in people config: {database_file}")
    
    # Load server_config
    server_cfg = {}
    if server_config_path.exists():
        text = server_config_path.read_text(encoding='utf8')
        try:
            server_cfg = yaml.safe_load(text) or {}
        except Exception as e:
            print(f"Failed to parse {server_config_path}: {e}")
            return
    else:
        print(f"Server config not found; cannot perform downgrade")
        return
    
    if dry_run:
        print("\nDry-run: would add database_path to server_config.yml:")
        server_cfg_copy = dict(server_cfg)
        server_cfg_copy['database_path'] = database_file
        print(yaml.safe_dump(server_cfg_copy, sort_keys=False))
        
        print("\nDry-run: would remove people.yml")
        return
    
    # Add database_path to server_config
    server_cfg['database_path'] = database_file
    
    if backup:
        bak = server_config_path.with_suffix(server_config_path.suffix + '.bak')
        shutil.copy2(server_config_path, bak)
        print(f"Backed up {server_config_path} -> {bak}")
    
    server_config_path.write_text(yaml.safe_dump(server_cfg, sort_keys=False), encoding='utf8')
    print(f"Updated {server_config_path}: added 'database_path: {database_file}'")
    
    # Remove people.yml
    if backup:
        bak = people_config_path.with_suffix(people_config_path.suffix + '.bak')
        shutil.copy2(people_config_path, bak)
        print(f"Backed up {people_config_path} -> {bak}")
    
    people_config_path.unlink()
    print(f"Removed {people_config_path}")
    
    print(f"✓ Downgrade complete: database_file moved back to server_config")
