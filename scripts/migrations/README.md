# PlannerTool Migrations

This directory contains database and configuration migration scripts for PlannerTool.

## Overview

Migrations are numbered sequentially (0000, 0001, 0002, etc.) and are applied in order by the migration runner (`scripts/migrate.py`).

## Migration file naming

Format: `NNNN_description.py`

- `NNNN`: Four-digit sequence number (0000, 0001, 0002, etc.)
- `description`: Brief description using underscores (e.g., `add_display_states`)

Examples:

- `0000_initial.py`
- `0013_projects_schema_v3_add_display_states.py`

## Migration structure

Each migration file must include:

1. **Module docstring**: Describes what the migration does
2. **MIGRATION_ID**: Unique identifier string
3. **upgrade()** function: Performs the migration
   - Parameters: `dry_run=False, backup=False`
   - Returns: None
   - Should be idempotent (safe to run multiple times)

Optional:

- **downgrade()** function: Reverts the migration

### Example template

```python
"""Migration: Brief description

Detailed description of what this migration does.
"""

MIGRATION_ID = 'NNNN.descriptive-name'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_path = root / 'data' / 'config' / 'myconfig.yml'

    print(f"Migration {MIGRATION_ID}: doing something")

    if not cfg_path.exists():
        print(f"Config file not found; nothing to do.")
        return

    # Read config
    text = cfg_path.read_text(encoding='utf8')
    cfg = yaml.safe_load(text) or {}

    # Check if migration already applied
    current_version = cfg.get('schema_version', 1)
    if current_version >= 2:
        print(f"Already at version {current_version}; nothing to do.")
        return

    # Make changes
    cfg['schema_version'] = 2
    # ... modify config ...

    # Dry-run preview
    if dry_run:
        print("\\nDry-run: would update to:")
        print(yaml.safe_dump(cfg, sort_keys=False))
        return

    # Backup
    if backup:
        bak = cfg_path.with_suffix('.yml.bak')
        shutil.copy2(cfg_path, bak)
        print(f"Backed up to {bak}")

    # Write changes
    cfg_path.write_text(
        yaml.safe_dump(cfg, sort_keys=False),
        encoding='utf8'
    )
    print(f"✓ Migration complete")


def downgrade():
    # Optional: revert the migration
    pass
```

## Running migrations

### Using migrate.py (recommended)

```bash
# List all migrations and their status
python3 scripts/migrate.py --list

# Preview what would be applied (dry-run)
python3 scripts/migrate.py --dry-run

# Apply all pending migrations
python3 scripts/migrate.py --apply

# Apply with automatic backups
python3 scripts/migrate.py --apply --backup
```

### Running individual migrations

```bash
# Dry-run a specific migration
python3 scripts/migrations/0013_projects_schema_v3_add_display_states.py --dry-run

# Apply with backup
python3 scripts/migrations/0013_projects_schema_v3_add_display_states.py --backup

# Apply without backup
python3 scripts/migrations/0013_projects_schema_v3_add_display_states.py
```

## Migration state tracking

Applied migrations are tracked in `data/migrations.json`:

```json
{
  "applied": [
    "0000.initial-create-state",
    "0001.add-schema-field-to-scenarios-and-users",
    ...
  ]
}
```

## Best practices

### 1. Idempotency

Migrations should be safe to run multiple times:

```python
# Check if already migrated
if 'new_field' in project:
    print(f"Already has new_field; skipping")
    continue
```

### 2. Schema versioning

Use schema_version to track config file versions:

```python
current_version = cfg.get('schema_version', 1)
if current_version >= 2:
    print("Already upgraded; nothing to do.")
    return
```

### 3. Backup support

Always support creating backups:

```python
if backup:
    bak = cfg_path.with_suffix('.yml.bak')
    shutil.copy2(cfg_path, bak)
    print(f"Backed up to {bak}")
```

### 4. Dry-run support

Preview changes before applying:

```python
if dry_run:
    print("\\nDry-run: would update to:")
    print(yaml.safe_dump(cfg, sort_keys=False))
    return
```

### 5. Informative output

Print clear status messages:

```python
print(f"Migration {MIGRATION_ID}: updating config")
print(f"  ✓ Updated {count} entries")
print(f"✓ Migration complete")
```

### 6. Error handling

Handle missing files gracefully:

```python
if not cfg_path.exists():
    print(f"Config file not found at {cfg_path}; nothing to do.")
    return
```

## Current migrations

- **0000**: Initial state creation
- **0001**: Add schema field to scenarios and users
- **0002**: Add server_name to config
- **0003**: Move accounts to data/accounts
- **0004**: Clear Azure cache
- **0005**: Add project_map type field
- **0006**: Split server_config into projects/teams
- **0007**: Rename database and update projects
- **0008**: Remove plugins from server_config
- **0009**: Clear Azure cache (key format change)
- **0010**: Teams schema v2 (rename team_map to teams)
- **0011**: Move database_path to people config
- **0012**: Clear cache for revision tracking
- **0013**: Projects schema v3 (add display_states)

## Creating new migrations

1. **Determine next number**: Check `ls scripts/migrations/` for latest number
2. **Create file**: `NNNN_descriptive_name.py`
3. **Write migration**: Follow template above
4. **Test dry-run**: `python3 scripts/migrations/NNNN_*.py --dry-run`
5. **Document**: Create `README_NNNN.md` if migration is complex
6. **Run**: `python3 scripts/migrate.py --apply --backup`
7. **Verify**: Check that changes were applied correctly
8. **Commit**: Add migration file and updated `data/migrations.json`

## Troubleshooting

### Migration not discovered

- Check filename starts with 4-digit number
- Ensure `MIGRATION_ID` is defined
- Verify `upgrade()` function exists

### Migration fails to run

- Check file permissions (`chmod +x` if needed for direct execution)
- Verify YAML syntax in config files
- Run with `--dry-run` first to preview changes

### Need to revert migration

- If downgrade() exists, run it directly
- Otherwise, restore from backup (.bak file)
- Manually edit `data/migrations.json` to remove from "applied" list

## References

- Migration runner: `scripts/migrate.py`
- Migration tracking: `data/migrations.json`
- Example migration: `scripts/migrations/0013_projects_schema_v3_add_display_states.py`
- Example docs: `scripts/migrations/README_0013.md`
