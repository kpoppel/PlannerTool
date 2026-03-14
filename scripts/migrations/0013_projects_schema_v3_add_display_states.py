"""Migration: Update projects.yml schema from v2 to v3

Schema v3 changes:
1. Add schema_version field set to 3
2. Add display_states field to each project_map entry
   - display_states includes all states from include_states
   - Adds "closed" state to display_states (if not already present)
   - Allows users to close tasks from UI even when closed state is not fetched

Behavior:
- Reads `data/config/projects.yml` and updates schema_version to 3
- For each project in project_map:
  - Creates display_states from include_states
  - Adds "closed" to display_states if not already present
  - Preserves all other project properties
- Supports `dry_run` to show changes without writing
- Supports `backup` to keep a backup of the original file
"""

MIGRATION_ID = '0013.projects-schema-v3-add-display-states'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    projects_path = cfg_dir / 'projects.yml'

    print(f"Migration {MIGRATION_ID}: updating projects.yml to schema_version 3")
    
    if not projects_path.exists():
        print(f"Projects file not found at {projects_path}; nothing to do.")
        return

    text = projects_path.read_text(encoding='utf8')
    try:
        cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse YAML from {projects_path}: {e}")
        return

    current_version = cfg.get('schema_version', 2)
    
    if current_version >= 3:
        print(f"Projects configuration is already at schema_version {current_version}; nothing to do.")
        return

    if current_version < 2:
        print(f"Warning: Projects configuration is at schema_version {current_version}.")
        print("This migration expects schema_version 2 or higher.")
        print("Please run earlier migrations first or manually update to v2.")
        return

    # Process project_map entries
    project_map = cfg.get('project_map', [])
    if not project_map:
        print("No project_map entries found; skipping migration.")
        cfg['schema_version'] = 3
    else:
        updated_count = 0
        for project in project_map:
            if not isinstance(project, dict):
                continue
            
            # Skip if display_states already exists
            if 'display_states' in project:
                print(f"  Project '{project.get('name', 'unknown')}' already has display_states; skipping")
                continue
            
            # Get include_states or default to empty list
            include_states = project.get('include_states', [])
            if not isinstance(include_states, list):
                include_states = []
            
            # Create display_states from include_states
            display_states = list(include_states)
            
            # Add 'Closed' if not already present (case-insensitive check)
            include_states_lower = [s.lower() for s in display_states]
            if 'closed' not in include_states_lower:
                display_states.append('Closed')
            
            # Set display_states on the project
            project['display_states'] = display_states
            updated_count += 1
            
            print(f"  ✓ Updated project '{project.get('name', 'unknown')}':")
            print(f"    include_states: {include_states}")
            print(f"    display_states: {display_states}")
        
        print(f"\nUpdated {updated_count} project(s) with display_states field")

    # Update schema version
    cfg['schema_version'] = 3

    if dry_run:
        print("\nDry-run: projects.yml would be updated to:")
        print(yaml.safe_dump(cfg, sort_keys=False, default_flow_style=False))
        return

    # Backup original if requested
    if backup:
        bak = projects_path.with_suffix('.yml.bak')
        shutil.copy2(projects_path, bak)
        print(f"\nBacked up original {projects_path} -> {bak}")

    # Write updated configuration
    projects_path.write_text(
        yaml.safe_dump(cfg, sort_keys=False, default_flow_style=False), 
        encoding='utf8'
    )
    print(f"\n✓ Updated {projects_path} to schema_version 3")
    print(f"✓ Migration complete: added display_states to all projects")


def downgrade():
    """Downgrade from schema v3 to v2
    
    Removes display_states field from all projects and sets schema_version to 2.
    This is useful for testing or reverting the migration.
    """
    from pathlib import Path
    import yaml
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    projects_path = cfg_dir / 'projects.yml'

    print(f"Downgrading projects.yml from schema_version 3 to 2")
    
    if not projects_path.exists():
        print(f"Projects file not found at {projects_path}; nothing to do.")
        return

    text = projects_path.read_text(encoding='utf8')
    try:
        cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse YAML from {projects_path}: {e}")
        return

    current_version = cfg.get('schema_version', 2)
    
    if current_version < 3:
        print(f"Projects configuration is at schema_version {current_version}; already below v3.")
        return

    # Remove display_states from all projects
    project_map = cfg.get('project_map', [])
    removed_count = 0
    for project in project_map:
        if isinstance(project, dict) and 'display_states' in project:
            del project['display_states']
            removed_count += 1
            print(f"  ✓ Removed display_states from '{project.get('name', 'unknown')}'")
    
    # Downgrade schema version
    cfg['schema_version'] = 2
    
    # Backup before downgrade
    bak = projects_path.with_suffix('.yml.v3.bak')
    shutil.copy2(projects_path, bak)
    print(f"\nBacked up v3 config to {bak}")
    
    # Write downgraded configuration
    projects_path.write_text(
        yaml.safe_dump(cfg, sort_keys=False, default_flow_style=False), 
        encoding='utf8'
    )
    print(f"\n✓ Downgraded {projects_path} to schema_version 2")
    print(f"✓ Removed display_states from {removed_count} project(s)")


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == '--downgrade':
        downgrade()
    elif len(sys.argv) > 1 and sys.argv[1] == '--dry-run':
        upgrade(dry_run=True)
    elif len(sys.argv) > 1 and sys.argv[1] == '--backup':
        upgrade(backup=True)
    else:
        upgrade()
