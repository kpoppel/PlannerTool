"""Migrate admin markers from 'accounts_admin' namespace to a 'permissions' field.

Previously, admin status was tracked by storing a copy of the account record
in a separate ``'accounts_admin'`` diskcache namespace.  With this migration,
admin status is stored as a ``permissions`` list inside the account record
itself (in the ``'accounts'`` namespace), e.g.::

    {
        'email': 'admin@example.com',
        'pat':   '<encrypted>',
        'permissions': ['admin']
    }

Regular users have an empty (or absent) ``permissions`` list.

Steps:
1. For every key in ``'accounts_admin'``, ensure the matching ``'accounts'``
   record has ``'admin'`` in its ``permissions`` list.  If no ``'accounts'``
   record exists, a minimal one is created from the admin marker data.
2. All entries in the ``'accounts_admin'`` namespace are deleted.

This migration is idempotent: running it more than once is safe.

Downgrade:
  Reads ``permissions`` from every ``'accounts'`` record and, for each account
  that has the ``'admin'`` permission, writes a copy back into ``'accounts_admin'``.
"""

MIGRATION_ID = '0018.permissions-field'

PERMISSION_ADMIN = 'admin'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import sys

    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))

    try:
        from planner_lib.storage import create_storage
    except ImportError as e:
        print(f"Migration {MIGRATION_ID}: Failed to import required modules: {e}")
        if dry_run:
            print("  [DRY-RUN] Would migrate accounts_admin → permissions field")
        else:
            raise
        return

    data_dir = root / 'data'
    storage = create_storage(
        backend='diskcache',
        serializer='raw',
        data_dir=str(data_dir / 'cache'),
    )

    print(f"Migration {MIGRATION_ID}: Migrating admin markers to permissions field")

    # ------------------------------------------------------------------
    # Step 1: Read all admin markers and merge into accounts records.
    # ------------------------------------------------------------------
    try:
        admin_keys = list(storage.list_keys('accounts_admin'))
    except Exception:
        admin_keys = []

    if not admin_keys:
        print("  No accounts_admin entries found — nothing to migrate.")
    else:
        print(f"  Found {len(admin_keys)} admin marker(s)")

    promoted = 0
    for admin_email in admin_keys:
        try:
            admin_record = storage.load('accounts_admin', admin_email)
        except Exception as e:
            print(f"  Could not load accounts_admin/{admin_email}: {e}")
            admin_record = {}

        # Load (or initialise) the matching accounts record.
        try:
            user_record = dict(storage.load('accounts', admin_email))
        except KeyError:
            # Admin marker without a corresponding user record — create one.
            raw = admin_record if isinstance(admin_record, dict) else {}
            user_record = {'email': admin_email}
            if raw.get('pat'):
                user_record['pat'] = raw['pat']
            print(f"  Creating missing accounts record for {admin_email}")

        permissions = list(user_record.get('permissions') or [])
        if PERMISSION_ADMIN not in permissions:
            permissions.append(PERMISSION_ADMIN)
            user_record['permissions'] = permissions
            if dry_run:
                print(f"  [DRY-RUN] Would add 'admin' permission for {admin_email}")
            else:
                storage.save('accounts', admin_email, user_record)
                print(f"  ✓ Added 'admin' permission for {admin_email}")
            promoted += 1
        else:
            print(f"  {admin_email}: already has 'admin' permission, skipping")

    # ------------------------------------------------------------------
    # Step 2: Optionally backup then delete all accounts_admin entries.
    # ------------------------------------------------------------------
    if admin_keys and backup:
        import json
        backup_dir = data_dir / 'backups' / f'migration_{MIGRATION_ID.split(".")[0]}'
        backup_dir.mkdir(parents=True, exist_ok=True)
        snapshot: dict = {}
        for key in admin_keys:
            try:
                snapshot[key] = storage.load('accounts_admin', key)
            except Exception:
                snapshot[key] = None
        backup_file = backup_dir / 'accounts_admin_snapshot.json'
        backup_file.write_text(json.dumps(snapshot, indent=2, default=str))
        print(f"  Backed up accounts_admin to {backup_file}")

    deleted = 0
    for key in admin_keys:
        if dry_run:
            print(f"  [DRY-RUN] Would delete accounts_admin/{key}")
        else:
            try:
                storage.delete('accounts_admin', key)
                deleted += 1
            except Exception as e:
                print(f"  Could not delete accounts_admin/{key}: {e}")

    if dry_run:
        print(f"\n[DRY-RUN] Would promote {promoted} account(s) and delete "
              f"{len(admin_keys)} admin marker(s)")
    else:
        print(f"\n✓ Migration complete: promoted {promoted} account(s), "
              f"deleted {deleted} admin marker(s)")


def downgrade(dry_run=False):
    """Revert by re-creating 'accounts_admin' entries from the permissions field."""
    from pathlib import Path
    import sys

    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))

    try:
        from planner_lib.storage import create_storage
    except ImportError as e:
        print(f"Migration {MIGRATION_ID}: Failed to import required modules: {e}")
        return

    data_dir = root / 'data'
    storage = create_storage(
        backend='diskcache',
        serializer='raw',
        data_dir=str(data_dir / 'cache'),
    )

    print(f"Migration {MIGRATION_ID} DOWNGRADE: Re-creating accounts_admin markers")

    try:
        user_keys = list(storage.list_keys('accounts'))
    except Exception:
        user_keys = []

    restored = 0
    for key in user_keys:
        try:
            record = storage.load('accounts', key)
        except Exception:
            continue
        if not isinstance(record, dict):
            continue
        if PERMISSION_ADMIN in (record.get('permissions') or []):
            marker = {k: v for k, v in record.items() if k != 'permissions'}
            if dry_run:
                print(f"  [DRY-RUN] Would restore accounts_admin/{key}")
            else:
                storage.save('accounts_admin', key, marker)
                print(f"  ✓ Restored accounts_admin/{key}")
            restored += 1

    if dry_run:
        print(f"\n[DRY-RUN] Would restore {restored} admin marker(s)")
    else:
        print(f"\n✓ Downgrade complete: restored {restored} admin marker(s)")
