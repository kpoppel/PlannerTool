"""Clear Azure workitems cache for revision tracking optimization.

This migration removes all existing cache files under `data/azure_workitems` 
to force a fresh rebuild with the new per-work-item revision tracking system.

Background:
The Azure caching client now tracks System.Rev for each work item to enable
intelligent selective refresh. Only items that have changed (based on revision
number comparison) are refetched, reducing API calls by 90-95%.

This migration clears:
- Area work item caches (e.g., Platform_Development__eSW__Teams__Architecture.pkl)
- Revision history caches (history_*)
- Plan markers (plan_markers_*)
- Iterations (iterations_*)
- Teams (teams_*)
- Plans (plans_*)
- Area-plan mappings (area_plan_*)
- Cache index (_index.pkl)

The new cache format stores revision numbers alongside work item data for
efficient change detection.

Behavior:
- Supports `dry_run` to list files that would be removed.
- If `backup=True` the removed files are moved to `data/backups/<MIGRATION_ID>/`.

See also:
- docs/AZURE_CACHE_OPTIMIZATION.md
- docs/plans/PLAN_PRIORITY_1_REVISION_TRACKING.md
- optimization_comparison.md
"""

MIGRATION_ID = '0012.clear-cache-revision-tracking'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import shutil
    import time

    root = Path(__file__).resolve().parents[2]
    data_dir = root / 'data' / 'azure_workitems'
    backups_root = root / 'data' / 'backups' / MIGRATION_ID

    print(f"Migration {MIGRATION_ID}: clearing Azure cache for revision tracking")
    print("Reason: New cache format with per-work-item revision tracking")
    
    if not data_dir.exists():
        print(f"No cache directory found at {data_dir}; nothing to do.")
        return

    to_remove = []
    for child in data_dir.iterdir():
        # Target all pickle files (work items, history, plans, markers, iterations, index)
        if child.is_file() and child.suffix == '.pkl':
            to_remove.append(child)
        # Also remove any subdirectories
        elif child.is_dir():
            to_remove.append(child)

    if not to_remove:
        print("No cache files found to remove.")
        return

    if dry_run:
        print("Dry-run: the following files/directories would be removed:")
        for p in to_remove:
            print(f" - {p}")
        print(f"\nTotal: {len(to_remove)} files/directories")
        print("\nCache types to be cleared:")
        print(" - Work item area caches")
        print(" - Revision history caches (history_*)")
        print(" - Plan markers (plan_markers_*)")
        print(" - Iterations (iterations_*)")
        print(" - Teams (teams_*)")
        print(" - Plans (plans_*)")
        print(" - Area-plan mappings (area_plan_*)")
        print(" - Cache index (_index.pkl)")
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
                if p.is_file():
                    shutil.move(str(p), str(target))
                else:
                    shutil.copytree(str(p), str(target))
                    shutil.rmtree(str(p))
                removed.append(str(p.name))
            else:
                if p.is_file():
                    p.unlink()
                else:
                    shutil.rmtree(p)
                removed.append(str(p.name))
        except Exception as e:
            print(f"Failed to remove {p}: {e}")
            failed.append(str(p.name))

    print(f"\nRemoved {len(removed)} cache file(s)/directory(ies)")
    if failed:
        print(f"Failed to remove {len(failed)} item(s):")
        for f in failed:
            print(f" - {f}")
    
    print("\nCache will be rebuilt with revision tracking on next server access.")
    print("Expected performance improvement: 90-95% reduction in API calls on refresh.")


def downgrade():
    """No downgrade available - caches will be rebuilt automatically."""
    print("No downgrade available for cache clearing. Caches will rebuild automatically.")
    print("Note: Old cache format (without revision tracking) is no longer supported.")
