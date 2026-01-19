"""Initial migration: create migrations state file if missing and create backups dir."""

MIGRATION_ID = '0000.initial-create-state'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    data_dir = root / 'data'
    migrations_file = data_dir / 'migrations.json'
    backups_dir = data_dir / 'backups'

    print(f"Migration {MIGRATION_ID}: ensuring {migrations_file} exists")
    if dry_run:
        return

    data_dir.mkdir(parents=True, exist_ok=True)
    if not migrations_file.exists():
        migrations_file.write_text('{"applied": []}')
        print(f"Created {migrations_file}")
    else:
        print(f"{migrations_file} already exists")

    if backup:
        backups_dir.mkdir(parents=True, exist_ok=True)
        print(f"Ensured backups directory {backups_dir}")
