"""Migration: Capitalize configured states in projects.yml

Purpose:
- Normalize `include_states` and `display_states` values so they have
  the first letter capitalized (e.g. "new" -> "New").
- This ensures the UI can display states using the canonical Azure casing
  provided in `projects.yml` while comparison logic remains case-insensitive.

Usage:
- Run as a script to apply the migration. Supports `--dry-run` and `--backup`.
"""

MIGRATION_ID = '0014.projects-states-capitalize'


def _title_state(s):
    try:
        return str(s).capitalize()
    except Exception:
        return s


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    projects_path = cfg_dir / 'projects.yml'

    print(f"Migration {MIGRATION_ID}: normalizing state casing in {projects_path}")

    if not projects_path.exists():
        print(f"Projects file not found at {projects_path}; nothing to do.")
        return

    text = projects_path.read_text(encoding='utf8')
    try:
        cfg = yaml.safe_load(text) or {}
    except Exception as e:
        print(f"Failed to parse YAML from {projects_path}: {e}")
        return

    project_map = cfg.get('project_map', [])
    if not project_map:
        print("No project_map entries found; nothing to do.")
        return

    changed = False
    for project in project_map:
        if not isinstance(project, dict):
            continue

        for key in ('include_states', 'display_states'):
            vals = project.get(key)
            if isinstance(vals, list) and vals:
                new_vals = []
                for s in vals:
                    if s is None:
                        continue
                    new_vals.append(_title_state(s))
                if new_vals != vals:
                    print(f"  - Project '{project.get('name','unknown')}' {key}: {vals} -> {new_vals}")
                    project[key] = new_vals
                    changed = True

    if not changed:
        print("No changes required; all configured states already capitalized.")
        return

    if dry_run:
        import json
        print('\nDry-run: resulting config would be:')
        print(yaml.safe_dump(cfg, sort_keys=False, default_flow_style=False))
        return

    if backup:
        bak = projects_path.with_suffix('.yml.capitalized.bak')
        shutil.copy2(projects_path, bak)
        print(f"Backed up original {projects_path} -> {bak}")

    projects_path.write_text(yaml.safe_dump(cfg, sort_keys=False, default_flow_style=False), encoding='utf8')
    print(f"✓ Updated {projects_path} with capitalized states")


def downgrade():
    print("This migration is not reversible automatically.")


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == '--dry-run':
        upgrade(dry_run=True)
    elif len(sys.argv) > 1 and sys.argv[1] == '--backup':
        upgrade(backup=True)
    else:
        upgrade()
