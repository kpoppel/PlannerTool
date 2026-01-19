"""Clear Azure workitems cache files migration.

This migration removes existing on-disk per-area cache files and the
`_index.pkl` file under `data/azure_workitems` so the `AzureCachingClient`
will regenerate fresh per-area caches using the new per-area
`_invalidated` format.

Behavior:
- Supports `dry_run` to list files that would be removed.
- If `backup=True` the removed files are moved to `data/backups/<MIGRATION_ID>/`.
"""

MIGRATION_ID = '0004.clear-azure-cache'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import shutil
    import time

    root = Path(__file__).resolve().parents[2]
    data_dir = root / 'data' / 'azure_workitems'
    backups_root = root / 'data' / 'backups' / MIGRATION_ID

    print(f"Migration {MIGRATION_ID}: clearing cache under {data_dir}")
    if not data_dir.exists():
        print(f"No cache directory found at {data_dir}; nothing to do.")
        return

    to_remove = []
    for child in data_dir.iterdir():
        # target pickle files and subdirectories
        if child.is_file() and child.suffix == '.pkl':
            to_remove.append(child)
        elif child.is_dir():
            to_remove.append(child)

    if not to_remove:
        print("No cache files found to remove.")
        return

    if dry_run:
        print("Dry-run: the following files/directories would be removed:")
        for p in to_remove:
            print(f" - {p}")
        return

    # perform removal, optionally backing up
    if backup:
        ts = int(time.time())
        dest = backups_root / str(ts)
        dest.mkdir(parents=True, exist_ok=True)
        print(f"Backing up removed cache files to {dest}")

    removed = []
    for p in to_remove:
        try:
            if backup:
                # move into backup dir
                target = dest / p.name
                shutil.move(str(p), str(target))
                removed.append(str(target))
            else:
                if p.is_file():
                    p.unlink()
                else:
                    shutil.rmtree(p)
                removed.append(str(p))
        except Exception as e:
            print(f"Failed to remove {p}: {e}")

    print(f"Removed {len(removed)} cache files/directories")
    for r in removed:
        print(" -", r)

