#!/usr/bin/env python3
"""Migration runner for PlannerTool.

Usage: python3 scripts/migrate.py [--list] [--dry-run] [--apply] [--backup]

This runner discovers migration scripts in `scripts/migrations` named
with a numeric prefix like `0000_description.py` and runs them in order.
Each migration module should provide a `MIGRATION_ID` string and an
`upgrade(dry_run=False, backup=False)` function.
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


def load_state():
    if not STATE_FILE.exists():
        return {"applied": []}
    with open(STATE_FILE, 'r') as f:
        return json.load(f)


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
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
    p.add_argument('--list', action='store_true')
    p.add_argument('--dry-run', action='store_true', help='force dry-run')
    p.add_argument('--apply', action='store_true', help='actually apply migrations')
    p.add_argument('--backup', action='store_true')
    args = p.parse_args(argv)

    migrations = discover_migrations()
    state = load_state()
    applied = set(state.get('applied', []))

    if args.list:
        for fname, mid, _ in migrations:
            print(f"{mid} {'(applied)' if mid in applied else ''}")
        return 0

    pending = [(fname, mid, up) for (fname, mid, up) in migrations if mid not in applied]
    if not pending:
        print("No pending migrations")
        return 0

    # Default to dry-run; require --apply to make changes.
    dry_run = True if not args.apply else False

    if dry_run:
        print("NOTE: running in dry-run mode. No changes will be made.")
        print("To apply changes, re-run with --apply")

    for fname, mid, up in pending:
        print(f"Running migration {mid} ({fname})")
        try:
            up(dry_run=dry_run, backup=args.backup)
        except Exception as e:
            print(f"Migration {mid} failed: {e}")
            return 2
        if not dry_run:
            state.setdefault('applied', []).append(mid)
            save_state(state)
            print(f"Marked {mid} as applied")
    print("Migrations complete")
    return 0


if __name__ == '__main__':
    sys.exit(main())
