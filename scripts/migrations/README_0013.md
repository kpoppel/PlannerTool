# Migration 0013: Projects Schema v3 - Add display_states

## Purpose

Upgrades `data/config/projects.yml` from schema version 2 to version 3 by adding the `display_states` field to each project configuration.

## What it does

1. **Adds schema_version: 3** to projects.yml
2. **Creates display_states field** for each project in project_map:
   - Copies all states from `include_states`
   - Automatically adds "closed" state to enable closing tasks from UI
   - Skips projects that already have `display_states` defined

## Example transformation

**Before (schema v2):**
```yaml
project_map:
- name: NN
  area_path: NN
  include_states:
  - new
  - active
  - defined
  - resolved
  task_types:
  - feature
  - epic
  type: team
```

**After (schema v3):**
```yaml
schema_version: 3
project_map:
- name: NN
  area_path: NN
  include_states:
  - new
  - active
  - defined
  - resolved
  display_states:    # NEW: States available in UI
  - new
  - active
  - defined
  - resolved
  - closed           # NEW: Automatically added
  task_types:
  - feature
  - epic
  type: team
```

## Running the migration

### Option 1: Using migrate.py (recommended)

```bash
# Preview all pending migrations
python3 scripts/migrate.py --list

# Dry-run to see changes without applying
python3 scripts/migrate.py --dry-run

# Apply all pending migrations with backup
python3 scripts/migrate.py --apply --backup

# Apply all pending migrations
python3 scripts/migrate.py --apply
```

### Option 2: Run migration directly

```bash
# Dry-run to preview changes
python3 scripts/migrations/0013_projects_schema_v3_add_display_states.py --dry-run

# Apply with backup
python3 scripts/migrations/0013_projects_schema_v3_add_display_states.py --backup

# Apply without backup
python3 scripts/migrations/0013_projects_schema_v3_add_display_states.py
```

## Downgrade (if needed)

To revert the migration:

```bash
python3 scripts/migrations/0013_projects_schema_v3_add_display_states.py --downgrade
```

This will:
- Remove `display_states` from all projects
- Set `schema_version` back to 2
- Create a backup of the v3 config before downgrading

## Safety features

- ✅ **Dry-run mode**: Preview changes before applying
- ✅ **Backup option**: Keeps original file as `.yml.bak`
- ✅ **Idempotent**: Safe to run multiple times (skips already migrated projects)
- ✅ **Non-destructive**: Only adds fields, never removes existing data
- ✅ **Downgrade support**: Can revert if needed

## What happens after migration

1. **Server restart**: The backend automatically handles v3 configs
   - Migration logic in `project_service.py` provides backward compatibility
   - Projects without `display_states` auto-populate from `include_states`

2. **Frontend updates**: UI automatically uses new `display_states`
   - Details Panel shows all configured display states
   - Users can now close tasks directly from UI
   - State filter in sidebar uses configured states

3. **Admin interface**: www-admin shows both fields
   - "States to Fetch" (include_states)
   - "States for UI Display" (display_states)

## Verification

After running the migration, verify it worked:

```bash
# Check schema version
grep "schema_version" data/config/projects.yml

# Check a project has display_states
grep -A 20 "name: Bluetooth" data/config/projects.yml | grep display_states

# Test via API (requires running server)
curl -s -H "X-Session-Id: YOUR_SESSION" http://localhost:8001/api/projects | jq '.[0].display_states'
```

## Related files

- Migration script: `scripts/migrations/0013_projects_schema_v3_add_display_states.py`
- Documentation: `docs/DISPLAY_STATES_IMPLEMENTATION.md`
- Schema definition: `planner_lib/admin/api.py`
- Backend logic: `planner_lib/projects/project_service.py`
- Frontend logic: `www/js/services/DataInitService.js`
