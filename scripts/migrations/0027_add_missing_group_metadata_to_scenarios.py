"""Migration: backfill legacy scenario metadata to the current contract.

Older persisted scenarios can be missing the canonical ``overrides``, ``filters``,
``view``, ``groupOverrides`` and ``scenarioGroups`` keys. Those fields are part of
our scenario contract, so they should be repaired at the data boundary rather than
being silently patched in the browser.

The actual scenario data is stored in the diskcache backend under ``data/cache``
using the ``scenarios`` namespace, not in a dedicated ``data/scenarios`` folder.
"""

MIGRATION_ID = '0027.add-missing-scenario-metadata-to-scenarios'

import sys
from pathlib import Path

_root = Path(__file__).resolve().parents[2]
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))


def _normalize_dict(value):
    if isinstance(value, dict):
        return value
    return {}


def _normalize_list(value):
    if isinstance(value, list):
        return value
    return []


def upgrade(dry_run=False, backup=False):
    """Backfill legacy scenario fields to the current contract."""
    root = _root
    cache_dir = root / 'data' / 'cache'
    backup_ns = 'scenarios_legacy_group_metadata_backup'

    print(f"Migration {MIGRATION_ID}: checking diskcache at {cache_dir} for legacy scenario metadata")
    if not cache_dir.exists():
        print(f"[INFO] {cache_dir} does not exist — nothing to migrate.")
        return

    try:
        from planner_lib.storage.diskcache_backend import DiskCacheStorage
    except ImportError as exc:
        print(f"[ERROR] Failed to import planner_lib: {exc}")
        raise

    storage = DiskCacheStorage(str(cache_dir))
    try:
        keys = sorted(storage.list_keys('scenarios'))
        scenario_keys = [key for key in keys if key != 'scenario_register']

        if not scenario_keys:
            print("[INFO] No scenario payloads found — already migrated or fresh install.")
            return

        changed = 0
        if dry_run:
            print("[DRY RUN] Would add missing group metadata to the following scenario keys:")
            for key in scenario_keys:
                try:
                    value = storage.load('scenarios', key)
                except KeyError:
                    continue
                if not isinstance(value, dict):
                    continue
                missing = []
                for field in ('overrides', 'filters', 'view', 'groupOverrides', 'scenarioGroups'):
                    if field == 'scenarioGroups':
                        if 'scenarioGroups' not in value or not isinstance(value.get('scenarioGroups'), list):
                            missing.append(field)
                    elif field in ('overrides', 'filters', 'view', 'groupOverrides'):
                        if field not in value or not isinstance(value.get(field), dict):
                            missing.append(field)
                if missing:
                    print(f"  {key}: {', '.join(missing)}")
            print("[DRY RUN] No data written.")
            return

        for key in scenario_keys:
            try:
                value = storage.load('scenarios', key)
            except KeyError:
                continue
            if not isinstance(value, dict):
                continue

            migrated = dict(value)
            for field, normalizer in {
                'overrides': _normalize_dict,
                'filters': _normalize_dict,
                'view': _normalize_dict,
                'groupOverrides': _normalize_dict,
                'scenarioGroups': _normalize_list,
            }.items():
                existing = value.get(field)
                if field not in migrated or not (
                    (field == 'scenarioGroups' and isinstance(existing, list)) or
                    (field != 'scenarioGroups' and isinstance(existing, dict))
                ):
                    if backup:
                        storage.save(backup_ns, f'{key}:{field}', existing)
                    migrated[field] = normalizer(existing)
                    changed += 1

            if migrated != value:
                storage.save('scenarios', key, migrated)

        print(f"[OK] Updated {changed} legacy metadata field(s) across {len(scenario_keys)} scenario(s).")
        if backup:
            print("[INFO] backup=True: original values were copied under the backup namespace before overwrite.")
    finally:
        storage.close()


def downgrade():
    """No-op: the app contract is now enforced and legacy repair is one-way."""
    pass
