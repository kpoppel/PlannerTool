"""Add memory_cache configuration to server_config.yml.

This migration adds the memory_cache section and enable_memory_cache feature flag
to server_config.yml if they don't already exist.

Behavior:
- Adds `enable_memory_cache: true` to feature_flags if not present
- Adds memory_cache configuration section with max_size_mb and staleness_seconds
- Preserves existing configuration and formatting where possible
- Supports `dry_run` and `backup`. When `backup` is True a `.bak` copy will be created.
"""

MIGRATION_ID = '0016.add-memory-cache-config'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    
    root = Path(__file__).resolve().parents[2]
    config_file = root / 'data' / 'config' / 'server_config.yml'
    
    if not config_file.exists():
        print(f"Migration {MIGRATION_ID}: config file not found: {config_file}")
        return
    
    text = config_file.read_text(encoding='utf8')
    
    # Check if memory_cache config already exists
    if 'memory_cache:' in text:
        print(f"Migration {MIGRATION_ID}: memory_cache already present in {config_file}")
        return
    
    print(f"Migration {MIGRATION_ID}: will add memory_cache config to {config_file}")
    if dry_run:
        print("  Would add:")
        print("    - enable_memory_cache: true to feature_flags")
        print("    - memory_cache section with max_size_mb and staleness_seconds")
        return
    
    # Backup if requested
    if backup:
        bak = config_file.with_suffix(config_file.suffix + '.bak')
        import shutil
        shutil.copy2(config_file, bak)
        print(f"Backed up {config_file} -> {bak}")
    
    # Parse YAML to preserve structure
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        print(f"Migration {MIGRATION_ID}: Failed to parse YAML: {e}")
        return
    
    modified = False
    
    # Add enable_memory_cache to feature_flags if not present
    if 'feature_flags' not in data:
        data['feature_flags'] = {}
    
    if 'enable_memory_cache' not in data['feature_flags']:
        data['feature_flags']['enable_memory_cache'] = True
        modified = True
        print("  Added enable_memory_cache: true to feature_flags")
    
    # Add memory_cache section if not present
    if 'memory_cache' not in data:
        data['memory_cache'] = {
            'max_size_mb': 50,
            'staleness_seconds': 1800
        }
        modified = True
        print("  Added memory_cache configuration section")
    
    if not modified:
        print(f"Migration {MIGRATION_ID}: No changes needed")
        return
    
    # Write back with formatting
    # Use custom YAML dumper to preserve order and formatting
    yaml_content = yaml.dump(data, default_flow_style=False, sort_keys=False, indent=2)
    
    # Add comment before memory_cache section for clarity
    if 'memory_cache:' in yaml_content:
        yaml_content = yaml_content.replace(
            'memory_cache:',
            '\n# Memory cache configuration (active when enable_memory_cache: true)\nmemory_cache:'
        )
    
    config_file.write_text(yaml_content, encoding='utf8')
    print(f"Migration {MIGRATION_ID}: Updated {config_file}")


def downgrade(dry_run=False):
    """Remove memory_cache configuration from server_config.yml."""
    from pathlib import Path
    import yaml
    
    root = Path(__file__).resolve().parents[2]
    config_file = root / 'data' / 'config' / 'server_config.yml'
    
    if not config_file.exists():
        print(f"Migration {MIGRATION_ID}: config file not found: {config_file}")
        return
    
    text = config_file.read_text(encoding='utf8')
    
    if 'memory_cache:' not in text:
        print(f"Migration {MIGRATION_ID}: memory_cache not present in {config_file}")
        return
    
    print(f"Migration {MIGRATION_ID}: will remove memory_cache config from {config_file}")
    if dry_run:
        return
    
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        print(f"Migration {MIGRATION_ID}: Failed to parse YAML: {e}")
        return
    
    # Remove memory_cache section
    if 'memory_cache' in data:
        del data['memory_cache']
        print("  Removed memory_cache section")
    
    # Remove enable_memory_cache from feature_flags
    if 'feature_flags' in data and 'enable_memory_cache' in data['feature_flags']:
        del data['feature_flags']['enable_memory_cache']
        print("  Removed enable_memory_cache from feature_flags")
    
    yaml_content = yaml.dump(data, default_flow_style=False, sort_keys=False, indent=2)
    config_file.write_text(yaml_content, encoding='utf8')
    print(f"Migration {MIGRATION_ID}: Downgraded {config_file}")


if __name__ == '__main__':
    import sys
    
    dry_run = '--dry-run' in sys.argv
    backup = '--backup' in sys.argv
    down = '--down' in sys.argv
    
    if down:
        downgrade(dry_run=dry_run)
    else:
        upgrade(dry_run=dry_run, backup=backup)
