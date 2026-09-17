"""Migration: replace saved-view expansion flags with canonical Context flags."""

MIGRATION_ID = '0029.migrate-view-expansion-to-context'

import sys
from pathlib import Path

_root = Path(__file__).resolve().parents[2]
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))


LEGACY_CONTEXT_FIELDS = {
    'expandRelations': ('dependency',),
    'expandTeamAllocated': ('otherAllocations',),
    'expandParentChild': ('parent', 'child'),
}


def _migrate_view(view):
    if not isinstance(view, dict):
        return view
    options = view.get('viewOptions')
    if not isinstance(options, dict):
        return view
    if not any(field in options for field in LEGACY_CONTEXT_FIELDS):
        return view

    migrated_options = dict(options)
    raw_context = options.get('context')
    context = dict(raw_context) if isinstance(raw_context, dict) else {}

    for legacy_field, context_fields in LEGACY_CONTEXT_FIELDS.items():
        enabled = bool(migrated_options.pop(legacy_field, False))
        for context_field in context_fields:
            context[context_field] = bool(context.get(context_field)) or enabled

    migrated_options['context'] = context
    migrated_view = dict(view)
    migrated_view['viewOptions'] = migrated_options
    return migrated_view


def upgrade(dry_run=False, backup=False):
    """Translate expansion flags in all persisted views and remove legacy keys."""
    cache_dir = _root / 'data' / 'cache'
    print(f'Migration {MIGRATION_ID}: checking saved views in {cache_dir}')
    if not cache_dir.exists():
        print(f'[INFO] {cache_dir} does not exist - nothing to migrate.')
        return

    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    storage = DiskCacheStorage(str(cache_dir))
    try:
        keys = sorted(
            key for key in storage.list_keys('views')
            if key != 'view_register'
        )
        changed = 0
        for key in keys:
            try:
                view = storage.load('views', key)
            except KeyError:
                continue
            migrated = _migrate_view(view)
            if migrated == view:
                continue
            changed += 1
            if dry_run:
                print(f'  [DRY RUN] Would migrate views/{key}')
                continue
            if backup:
                storage.save('views_expansion_backup', key, view)
            storage.save('views', key, migrated)

        if dry_run:
            print(f'[DRY RUN] Would migrate {changed} saved view(s). No data written.')
        else:
            print(f'[OK] Migrated {changed} saved view(s) to canonical Context.')
            if backup and changed:
                print('[INFO] Original views copied to views_expansion_backup.')
    finally:
        storage.close()


def downgrade():
    """No-op: expansion state has been removed from the application contract."""
    pass
