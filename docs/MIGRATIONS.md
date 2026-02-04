# Migrations

PlannerTool provides a simple migration runner for one-off repository migrations.

Location
- Migration scripts: `scripts/migrations`
- Runner: `scripts/migrate.py`

Conventions
- Migration files are named with a numeric prefix, e.g. `0000_initial.py`.
- Each migration module should expose:
  - `MIGRATION_ID` (string) - unique identifier
  - `upgrade(dry_run=False, backup=False)` - function to perform the migration

State
- Applied migrations are recorded in `data/migrations.json`.

Usage
```
python3 scripts/migrate.py --list        # list migrations and show applied state
python3 scripts/migrate.py               # default: dry-run (no changes)
python3 scripts/migrate.py --dry-run     # explicitly preview actions without applying
python3 scripts/migrate.py --apply       # actually run pending migrations and mark them applied
python3 scripts/migrate.py --apply --backup  # run and request backups when supported
```

Notes
- Keep migrations idempotent and small.
- Backups are performed only if a migration honors the `backup` flag.
- Add tests for any non-trivial migration.
