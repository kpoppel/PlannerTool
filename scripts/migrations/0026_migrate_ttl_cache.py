"""Migration: Move the volatile remote-backend cache out of the authoritative store.

``CachingBackend`` used to share the same diskcache directory
(``data/cache``) as config, accounts, sessions, and user data, storing its
``fetch_*`` results and ``taskmeta__*`` freshness sidecars under the
``backend_domain`` namespace right alongside that authoritative data. It now
uses its own dedicated diskcache instance at ``data/remote_cache`` so that
directory is a purely disposable cache — deleting it can never take
config/accounts/sessions/user data down with it (see
``docs/ARCHITECTURE_BACKEND_DATA.md``).

This migration moves every ``backend_domain`` key already sitting in
``data/cache`` (left over from before the split) into ``data/remote_cache``:

  data/cache::backend_domain::fetch_history__<hash>   -> data/remote_cache::backend_domain::fetch_history__<hash>
  data/cache::backend_domain::taskmeta__<hash>         -> data/remote_cache::backend_domain::taskmeta__<hash>
  ... (fetch_teams, fetch_plans, fetch_markers, fetch_iterations, fetch_tasks)

Behaviour
---------
- Idempotent: only keys still present under ``backend_domain`` in
  ``data/cache`` are moved. Re-running after a successful migration finds
  nothing left to do.
- If a key already exists in ``data/remote_cache`` (e.g. it was re-fetched
  there since the code split shipped), the newer entry in
  ``data/remote_cache`` wins — the stale copy in ``data/cache`` is simply
  dropped instead of overwriting it.
- No hard diskcache TTL is applied when writing to the new store: freshness
  for these entries is governed entirely by the ``taskmeta__*`` sidecar (or,
  if a data key has no matching sidecar, ``CachingBackend`` treats it as
  soft-expired and refreshes it on next read — safe either way).
- ``backup=True`` leaves the migrated keys in ``data/cache`` in place
  (skips the delete step) instead of overwriting them, so the old data
  remains recoverable; ``dry_run=True`` writes nothing at all.

Requirements
------------
- Python package: ``diskcache`` (already in requirements.txt).
- Safe to run while the server is stopped or running; ``CachingBackend``
  tolerates a cache entry disappearing mid-request (treated as a miss).
"""

MIGRATION_ID = '0026.migrate-ttl-cache-to-remote-cache-storage'

# Must match `_NAMESPACE` in planner_lib/backend/caching.py
_NAMESPACE = 'backend_domain'

import sys
from pathlib import Path

_root = Path(__file__).resolve().parents[2]
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))


def upgrade(dry_run=False, backup=False):
    """Move CachingBackend's ``backend_domain`` cache entries into ``data/remote_cache``.

    Parameters
    ----------
    dry_run : bool
        If True, print what would move without writing or deleting anything.
    backup : bool
        If True, keep the migrated keys in ``data/cache`` instead of deleting
        them once copied.
    """
    root = _root
    old_dir = root / 'data' / 'cache'
    new_dir = root / 'data' / 'remote_cache'

    print(f"Migration {MIGRATION_ID}: checking {old_dir} for legacy '{_NAMESPACE}' entries")

    if not old_dir.exists():
        print(f"[INFO] {old_dir} does not exist — nothing to migrate.")
        return

    try:
        from planner_lib.storage.diskcache_backend import DiskCacheStorage
    except ImportError as exc:
        print(f"[ERROR] Failed to import planner_lib: {exc}")
        raise

    old_storage = DiskCacheStorage(str(old_dir))
    try:
        keys = list(old_storage.list_keys(_NAMESPACE))
        if not keys:
            print(f"[INFO] No '{_NAMESPACE}' entries in {old_dir} — already migrated (or fresh install).")
            return

        print(f"Found {len(keys)} '{_NAMESPACE}' entr{'y' if len(keys) == 1 else 'ies'} to move to {new_dir}")

        if dry_run:
            print("[DRY RUN] Would move the following keys (and delete them from data/cache):")
            for key in keys:
                print(f"  {_NAMESPACE}::{key}")
            return

        new_storage = DiskCacheStorage(str(new_dir))
        try:
            moved = 0
            skipped_existing = 0
            skipped_expired = 0
            for key in keys:
                if new_storage.exists(_NAMESPACE, key):
                    # data/remote_cache already has a (newer) copy from live traffic
                    # since the storage split shipped — keep that one.
                    skipped_existing += 1
                    if not backup:
                        try:
                            old_storage.delete(_NAMESPACE, key)
                        except KeyError:
                            pass
                    continue

                try:
                    # Legacy entries still carry their old hard diskcache TTL and
                    # may already be logically expired (though not yet physically
                    # purged from the index — see the expire() sweep below).
                    value = old_storage.load(_NAMESPACE, key)
                except KeyError:
                    skipped_expired += 1
                    continue

                new_storage.save(_NAMESPACE, key, value)
                moved += 1
                if not backup:
                    try:
                        old_storage.delete(_NAMESPACE, key)
                    except KeyError:
                        pass

            if not backup and skipped_expired:
                # Entries that are already logically expired are invisible to
                # load()/delete() (both respect the diskcache expiry check) yet
                # can still linger as physical rows in the index. A cull/expire
                # sweep is the only way to actually purge them.
                purged = old_storage._cache.expire()
                print(f"[INFO] Purged {purged} physically-lingering expired row(s) from data/cache.")
        finally:
            new_storage.close()

        print(f"[OK] Moved {moved} entr{'y' if moved == 1 else 'ies'}; "
              f"{skipped_existing} already present in data/remote_cache were left as-is; "
              f"{skipped_expired} were already expired and were dropped.")
        if backup:
            print("[INFO] backup=True: original entries were left in data/cache untouched.")
        else:
            print("[INFO] Migrated entries removed from data/cache.")
    finally:
        old_storage.close()


def downgrade():
    # Not supported: the old code path that read backend_domain data from
    # data/cache no longer exists, so moving keys back would be inert.
    pass
