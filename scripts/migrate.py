#!/usr/bin/env python3
"""Migration runner for PlannerTool.

Usage: python3 scripts/migrate.py [--list] [--dry-run] [--apply] [--backup] [--from-version VERSION]

This runner discovers migration scripts in `scripts/migrations` named
with a numeric prefix like `0000_description.py` and runs them in order.
Each migration module should provide a `MIGRATION_ID` string and an
`upgrade(dry_run=False, backup=False)` function.

Version-aware migrations:
- Tracks the tool version in migrations.json
- Can mark migrations as "required_from_version" to skip obsolete migrations
- Use --from-version to specify the version you're migrating from (for fresh installs)
"""
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / 'scripts' / 'migrations'
STATE_FILE = ROOT / 'data' / 'migrations.json'
VERSION_FILE = ROOT / 'VERSION'

# Migrations that should only run when migrating from older versions.
# Format: {migration_id: "min_version_to_run"}
# If current or from_version >= min_version_to_run, the migration is skipped as obsolete.
OBSOLETE_MIGRATIONS = {
    '0000.initial-create-state': '3.0.0',  # State file created automatically
    '0001.add-schema-field': '3.0.0',      # Schema fields now default
    '0002.add-server-name-to-config': '3.0.0',  # Server name now required
    '0003.move-accounts-to-data-accounts': '3.0.0',  # Accounts moved long ago
    '0004.clear-azure-cache': '3.0.0',     # Cache format changed long ago
    '0005.add-project-map-type': '3.0.0',  # Project map type now required
    '0006.split-server-config-into-projects-teams': '3.1.0',  # Config split done
    '0007.rename-db-and-update-projects': '3.1.0',  # Database renamed
    '0008.remove-plugins-from-server-config': '3.1.0',  # Plugins removed
    '0009.clear-azure-cache-for-key-format': '3.1.0',  # Cache key format changed
    '0010.teams-schema-v2-rename-team-map-to-teams': '3.1.0',  # Schema v2 done
    '0011.move-database-path-to-people-config': '3.1.0',  # Database path moved
    '0012.clear-cache-for-revision-tracking': '3.1.0',  # Revision tracking added
    '0013.projects-schema-v3-add-display-states': '3.2.0',  # Display states added
    '0014.projects-states-capitalize': '3.2.0',  # States capitalized
    '0015_migrate_pickle_to_diskcache': '3.2.0',  # Feature flags added
}


def get_current_version():
    """Read the current tool version from VERSION file."""
    if VERSION_FILE.exists():
        return VERSION_FILE.read_text().strip()
    return "0.0.0"


def parse_version(version_str):
    """Parse a semantic version string to a tuple for comparison."""
    try:
        parts = version_str.lstrip('v').split('.')
        return tuple(int(p) for p in parts[:3])
    except (ValueError, AttributeError):
        return (0, 0, 0)


def is_obsolete(migration_id, from_version):
    """Check if a migration is obsolete based on the from_version.
    
    Returns True if the migration should be skipped because the from_version
    is already at or beyond the version where this migration became obsolete.
    """
    if migration_id not in OBSOLETE_MIGRATIONS:
        return False
    
    obsolete_version = OBSOLETE_MIGRATIONS[migration_id]
    return parse_version(from_version) >= parse_version(obsolete_version)


def load_state():
    """Load migration state including applied migrations and version info."""
    if not STATE_FILE.exists():
        current_version = get_current_version()
        return {
            "applied": [],
            "current_version": current_version,
            "last_migration_version": None
        }
    with open(STATE_FILE, 'r') as f:
        state = json.load(f)
        # Ensure version fields exist (backward compatibility)
        if "current_version" not in state:
            state["current_version"] = get_current_version()
        if "last_migration_version" not in state:
            state["last_migration_version"] = None
        return state


def save_state(state):
    """Save migration state with version tracking."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    state["current_version"] = get_current_version()
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def discover_migrations():
    if not MIGRATIONS_DIR.exists():
        return []
    files = sorted([p for p in MIGRATIONS_DIR.iterdir() if p.is_file() and p.name[0].isdigit()])
    migrations = []
    for f in files:
        spec = importlib.util.spec_from_file_location(f.stem, str(f))
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            print(f"Failed to load migration {f.name}: {e}")
            continue
        mid = getattr(mod, 'MIGRATION_ID', f.name)
        upgrade = getattr(mod, 'upgrade', None)
        if not callable(upgrade):
            print(f"Skipping {f.name}: no callable upgrade() found")
            continue
        migrations.append((f.name, mid, upgrade))
    return migrations


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--list', action='store_true', help='list all migrations and their status')
    p.add_argument('--dry-run', action='store_true', help='preview changes without applying')
    p.add_argument('--apply', action='store_true', help='actually apply migrations')
    p.add_argument('--backup', action='store_true', help='create backups before applying')
    p.add_argument('--from-version', help='version to migrate from (for fresh installs or version jumps)')
    args = p.parse_args(argv)

    migrations = discover_migrations()
    state = load_state()
    applied = set(state.get('applied', []))
    current_version = get_current_version()
    from_version = args.from_version or state.get('last_migration_version') or "0.0.0"

    if args.list:
        print(f"Current version: {current_version}")
        print(f"Migration from version: {from_version}")
        print(f"\nMigrations:")
        for fname, mid, _ in migrations:
            status = "(applied)" if mid in applied else ""
            obsolete = "(obsolete)" if is_obsolete(mid, from_version) else ""
            print(f"  {mid:60} {status:12} {obsolete}")
        return 0

    # Filter out obsolete migrations
    pending = []
    for fname, mid, up in migrations:
        if mid in applied:
            continue
        if is_obsolete(mid, from_version):
            print(f"Skipping obsolete migration {mid} (not needed for version {from_version}+)")
            # Mark as applied so we don't check it again
            if not args.dry_run:
                state.setdefault('applied', []).append(mid)
            continue
        pending.append((fname, mid, up))

    if not pending:
        print(f"No pending migrations (current version: {current_version}, from: {from_version})")
        # Update state even if no migrations ran
        if not args.dry_run:
            state['last_migration_version'] = current_version
            save_state(state)
        return 0

    # Default to dry-run; require --apply to make changes.
    dry_run = True if not args.apply else False

    if dry_run:
        print("=" * 70)
        print("DRY-RUN MODE: No changes will be made")
        print("To apply changes, re-run with --apply")
        print("=" * 70)

    print(f"Migrating from version {from_version} to {current_version}")
    print(f"Found {len(pending)} pending migration(s)\n")

    for fname, mid, up in pending:
        print(f"Running migration {mid} ({fname})")
        try:
            up(dry_run=dry_run, backup=args.backup)
        except Exception as e:
            print(f"Migration {mid} failed: {e}")
            import traceback
            traceback.print_exc()
            return 2
        if not dry_run:
            state.setdefault('applied', []).append(mid)
            state['last_migration_version'] = current_version
            save_state(state)
            print(f"✓ Marked {mid} as applied\n")
    
    if dry_run:
        print("\n" + "=" * 70)
        print("DRY-RUN COMPLETE: No changes were made")
        print("Re-run with --apply to execute migrations")
        print("=" * 70)
    else:
        print("\n" + "=" * 70)
        print(f"✓ Migrations complete: {len(pending)} migration(s) applied")
        print(f"✓ Updated to version {current_version}")
        print("=" * 70)
    return 0


if __name__ == '__main__':
    sys.exit(main())
