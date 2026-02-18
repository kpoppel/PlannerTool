"""Clear Azure workitems cache due to cache key format change.

This migration removes existing on-disk per-area cache files and the
`_index.pkl` file under `data/azure_workitems` to force a fresh rebuild
with the new cache key format (using double underscores instead of backslashes).

Background:
The cache key format was changed to use double underscores (`__`) instead of
backslashes (`\\`) for consistency and better cross-platform compatibility.
Area paths like `Platform_Development\\eSW` are now cached as
`Platform_Development__eSW` instead.

Behavior:
- Supports `dry_run` to list files that would be removed.
- If `backup=True` the removed files are moved to `data/backups/<MIGRATION_ID>/`.
"""

MIGRATION_ID = '0009.clear-azure-cache-key-format'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import shutil
    import time

    root = Path(__file__).resolve().parents[2]
    data_dir = root / 'data' / 'azure_workitems'
    backups_root = root / 'data' / 'backups' / MIGRATION_ID

    print(f"Migration {MIGRATION_ID}: clearing Azure cache for key format change")
    if not data_dir.exists():
        print(f"No cache directory found at {data_dir}; nothing to do.")
        return

    to_remove = []
    for child in data_dir.iterdir():
        # Target all pickle files (including _index.pkl)
        if child.is_file() and child.suffix == '.pkl':
            to_remove.append(child)

    if not to_remove:
        print("No cache files found to remove.")
        return

    if dry_run:
        print("Dry-run: the following files would be removed:")
        for p in to_remove:
            print(f" - {p}")
        print(f"\nTotal: {len(to_remove)} files")
        return

    # Perform removal, optionally backing up
    if backup:
        ts = int(time.time())
        dest = backups_root / str(ts)
        dest.mkdir(parents=True, exist_ok=True)
        print(f"Backing up removed cache files to {dest}")
    else:
        dest = None

    removed = []
    failed = []
    for p in to_remove:
        try:
            if backup:
                # Move into backup dir
                target = dest / p.name
                shutil.move(str(p), str(target))
                removed.append(str(p.name))
            else:
                p.unlink()
                removed.append(str(p.name))
        except Exception as e:
            print(f"Failed to remove {p}: {e}")
            failed.append(str(p.name))

    print(f"\nRemoved {len(removed)} cache file(s)")
    if failed:
        print(f"Failed to remove {len(failed)} file(s):")
        for f in failed:
            print(f" - {f}")
    
    print("\nCache will be rebuilt on next server access.")


def downgrade():
    """No downgrade available - caches will be rebuilt automatically."""
    print("No downgrade available for cache clearing. Caches will rebuild automatically.")
