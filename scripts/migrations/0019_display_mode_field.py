"""Migrate saved views and scenarios from the legacy ``condensedCards`` boolean to
the new ``displayMode`` string field.

Background
----------
Display mode was previously stored as a boolean ``condensedCards`` inside
``viewOptions`` of both saved *views* and *scenario* view-state snapshots:

    "condensedCards": false   → displayMode = "normal"
    "condensedCards": true    → displayMode = "compact"

In v3.6.0 a third mode ("packed") was added and ``displayMode`` became the
canonical field.  ``condensedCards`` is now a derived, read-only alias kept
only for backward compatibility with older API clients.

What this migration does
------------------------
For every item stored in the ``views`` and ``scenarios`` diskcache namespaces:

1. Load the item data.
2. Find any dict that contains a ``viewOptions`` key (or is a flat view-options
   dict itself, as some scenario payloads store the options at the top level).
3. If ``displayMode`` is already present → leave it untouched (idempotent).
4. If only ``condensedCards`` is present → derive ``displayMode``:
   - ``False`` (or absent) → ``"normal"``
   - ``True``              → ``"compact"``
5. Write the updated record back to storage.

The migration is idempotent: running it more than once is safe because records
that already have ``displayMode`` are skipped.

Downgrade
---------
No downgrade is provided.  The ``condensedCards`` boolean is still read by the
``ViewService.applyViewStateSilently`` fallback path, so older clients continue
to work even after the upgrade.
"""

MIGRATION_ID = '0019.display-mode-field'

# The storage namespaces and register keys to inspect.
_NAMESPACES = [
    {
        'namespace': 'views',
        'register_key': 'view_register',
    },
    {
        'namespace': 'scenarios',
        'register_key': 'scenario_register',
    },
]


def _migrate_view_options(vo: dict) -> bool:
    """Add ``displayMode`` to *vo* (a viewOptions dict) if missing.

    Returns ``True`` when the dict was modified, ``False`` when it was already
    up-to-date or is not a dict.
    """
    if not isinstance(vo, dict):
        return False
    if 'displayMode' in vo:
        # Already migrated — nothing to do.
        return False
    condensed = vo.get('condensedCards', False)
    vo['displayMode'] = 'compact' if condensed else 'normal'
    return True


def _migrate_record(data) -> bool:
    """Walk *data* and migrate any embedded viewOptions dicts.

    Returns ``True`` if at least one change was made.
    """
    if not isinstance(data, dict):
        return False

    changed = False

    # Pattern 1: top-level ``viewOptions`` key (saved-view format).
    if 'viewOptions' in data and isinstance(data['viewOptions'], dict):
        changed = _migrate_view_options(data['viewOptions']) or changed

    # Pattern 2: ``viewState.viewOptions`` (some scenario payloads).
    view_state = data.get('viewState')
    if isinstance(view_state, dict):
        if 'viewOptions' in view_state and isinstance(view_state['viewOptions'], dict):
            changed = _migrate_view_options(view_state['viewOptions']) or changed

    # Pattern 3: flat viewOptions at top level (legacy scenario snapshot).
    # Heuristic: the dict itself looks like a viewOptions blob when it has
    # ``timelineScale`` but no ``viewOptions`` sub-key.
    if 'timelineScale' in data and 'viewOptions' not in data:
        changed = _migrate_view_options(data) or changed

    return changed


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import json
    import sys

    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))

    try:
        from planner_lib.storage import create_storage
    except ImportError as e:
        print(f"Migration {MIGRATION_ID}: Failed to import required modules: {e}")
        if dry_run:
            print("  [DRY-RUN] Would migrate condensedCards → displayMode in views/scenarios")
        else:
            raise
        return

    data_dir = root / 'data'
    storage = create_storage(
        backend='diskcache',
        serializer='raw',
        data_dir=str(data_dir / 'cache'),
    )

    print(f"Migration {MIGRATION_ID}: migrating condensedCards → displayMode")

    total_checked = 0
    total_updated = 0

    for spec in _NAMESPACES:
        ns = spec['namespace']
        register_key = spec['register_key']

        # Load the register to enumerate all stored items.
        try:
            register = storage.load(ns, register_key)
        except (KeyError, Exception):
            register = {}

        if not isinstance(register, dict):
            print(f"  [{ns}] Register is not a dict — skipping namespace.")
            continue

        # The register maps storage_key → metadata dict.
        # Item data is stored under the same key in the same namespace.
        item_keys = [k for k in register if k != register_key]
        print(f"  [{ns}] {len(item_keys)} item(s) in register")

        for storage_key in item_keys:
            total_checked += 1
            try:
                data = storage.load(ns, storage_key)
            except (KeyError, Exception) as exc:
                print(f"  [{ns}/{storage_key}] Could not load: {exc} — skipping")
                continue

            if not isinstance(data, dict):
                # Stored as bytes or other non-dict — skip.
                continue

            # Work on a copy so we can detect changes without modifying in place
            # before a successful write.
            import copy
            data_copy = copy.deepcopy(data)
            modified = _migrate_record(data_copy)

            if not modified:
                continue  # Already up-to-date.

            # Report what changed.
            def _find_display_modes(d, path=''):
                """Collect all (path, displayMode) tuples from the migrated copy."""
                results = []
                if not isinstance(d, dict):
                    return results
                if 'displayMode' in d:
                    results.append((path or '<root>', d['displayMode']))
                for k, v in d.items():
                    if isinstance(v, dict):
                        results.extend(_find_display_modes(v, f'{path}.{k}' if path else k))
                return results

            modes = _find_display_modes(data_copy)
            desc = ', '.join(f"{p}={m}" for p, m in modes)

            if dry_run:
                print(f"  [{ns}/{storage_key}] DRY-RUN: would set {desc}")
                total_updated += 1
            else:
                if backup:
                    # Write a JSON snapshot of the original record.
                    backup_dir = data_dir / 'backups' / f'migration_{MIGRATION_ID.split(".")[0]}'
                    backup_dir.mkdir(parents=True, exist_ok=True)
                    bak_file = backup_dir / f'{ns}_{storage_key}.json'
                    try:
                        bak_file.write_text(
                            json.dumps(data, indent=2, default=str), encoding='utf-8'
                        )
                    except Exception as bak_exc:
                        print(f"  [{ns}/{storage_key}] Backup failed: {bak_exc}")

                try:
                    storage.save(ns, storage_key, data_copy)
                    print(f"  [{ns}/{storage_key}] Updated: {desc}")
                    total_updated += 1
                except Exception as write_exc:
                    print(f"  [{ns}/{storage_key}] Write failed: {write_exc}")

    action = "Would update" if dry_run else "Updated"
    print(
        f"Migration {MIGRATION_ID}: {action} {total_updated}/{total_checked} record(s)."
    )
