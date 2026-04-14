"""Migrate unencrypted PATs to encrypted format.

This migration encrypts all Personal Access Tokens (PATs) stored in the
accounts and accounts_admin namespaces using Fernet encryption with the
PLANNER_SECRET_KEY environment variable.

Behavior:
- Reads all accounts from 'accounts' and 'accounts_admin' namespaces
- Detects unencrypted PATs (not base64-encoded Fernet tokens)
- Encrypts PATs using the _encrypt_pat function from accounts.config
- Preserves all other account data unchanged
- Supports dry_run to preview changes without writing
- Supports backup to create timestamped backups before migration
- Idempotent: safe to run multiple times (skips already-encrypted PATs)

Requirements:
- PLANNER_SECRET_KEY environment variable must be set
"""

MIGRATION_ID = '0017.encrypt-pats'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import os
    import sys
    
    # Add planner_lib to path to import AccountManager
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))
    
    try:
        from planner_lib.accounts.config import _encrypt_pat, _decrypt_pat
        from planner_lib.storage import create_storage
    except ImportError as e:
        print(f"Migration {MIGRATION_ID}: Failed to import required modules: {e}")
        if dry_run:
            print("  [DRY-RUN] Would encrypt all unencrypted PATs in accounts and accounts_admin")
            print("  Requires: planner_lib dependencies and PLANNER_SECRET_KEY environment variable")
            return
        else:
            print("  ERROR: Install required dependencies to run this migration")
            raise
    
    # Verify PLANNER_SECRET_KEY is set
    if not os.environ.get('PLANNER_SECRET_KEY'):
        print(f"Migration {MIGRATION_ID}: PLANNER_SECRET_KEY not set. Cannot encrypt PATs.")
        if dry_run:
            print("  [DRY-RUN] Would encrypt PATs (requires PLANNER_SECRET_KEY environment variable)")
            return
        else:
            print("Set PLANNER_SECRET_KEY environment variable before running this migration.")
            return
    
    data_dir = root / 'data'
    # Create storage using diskcache backend (where accounts are stored)
    storage = create_storage(
        backend="diskcache",
        serializer="raw",
        data_dir=str(data_dir / 'cache')
    )
    
    print(f"Migration {MIGRATION_ID}: Checking for unencrypted PATs")
    
    # Process both regular accounts and admin accounts
    namespaces = ['accounts', 'accounts_admin']
    total_updated = 0
    
    for namespace in namespaces:
        try:
            keys = list(storage.list_keys(namespace))
        except Exception:
            print(f"  No {namespace} found, skipping")
            continue
        
        if not keys:
            print(f"  No accounts found in {namespace}")
            continue
        
        print(f"  Checking {len(keys)} account(s) in {namespace}")
        
        for key in keys:
            try:
                account = storage.load(namespace, key)
            except Exception as e:
                print(f"    Failed to load {namespace}/{key}: {e}")
                continue
            
            if not isinstance(account, dict):
                print(f"    Skipping {namespace}/{key}: not a dict")
                continue
            
            pat = account.get('pat')
            if not pat or not isinstance(pat, str):
                print(f"    Skipping {namespace}/{key}: no PAT or invalid type")
                continue
            
            # Check if PAT is already encrypted by attempting to decrypt
            # Encrypted PATs are base64-encoded Fernet tokens
            is_encrypted = False
            try:
                # Try to decrypt - if it works, it's already encrypted
                _decrypt_pat(pat)
                is_encrypted = True
            except Exception:
                # Decryption failed - PAT is probably plaintext
                is_encrypted = False
            
            if is_encrypted:
                print(f"    {namespace}/{key}: already encrypted, skipping")
                continue
            
            print(f"    {namespace}/{key}: encrypting PAT")
            
            if dry_run:
                print(f"      [DRY-RUN] Would encrypt PAT for {key}")
                total_updated += 1
                continue
            
            # Backup if requested
            if backup:
                backup_dir = data_dir / 'backups' / 'migration_0017'
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_file = backup_dir / f'{namespace}_{key.replace("@", "_at_")}.json'
                import json
                backup_file.write_text(json.dumps(account, indent=2))
                print(f"      Backed up to {backup_file}")
            
            # Encrypt the PAT
            try:
                encrypted_pat = _encrypt_pat(pat)
                account['pat'] = encrypted_pat
                storage.save(namespace, key, account)
                print(f"      ✓ Encrypted PAT for {key}")
                total_updated += 1
            except Exception as e:
                print(f"      ✗ Failed to encrypt PAT for {key}: {e}")
    
    if dry_run:
        print(f"\n[DRY-RUN] Would encrypt {total_updated} PAT(s)")
    else:
        print(f"\n✓ Migration complete: encrypted {total_updated} PAT(s)")


def downgrade(dry_run=False):
    """Revert migration by decrypting all PATs back to plaintext.
    
    WARNING: This stores PATs in plaintext and should only be used
    for rollback purposes in a safe environment.
    """
    from pathlib import Path
    import os
    import sys
    
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))
    
    try:
        from planner_lib.accounts.config import _encrypt_pat, _decrypt_pat
        from planner_lib.storage import create_storage
    except ImportError as e:
        print(f"Migration {MIGRATION_ID}: Failed to import required modules: {e}")
        return
    
    if not os.environ.get('PLANNER_SECRET_KEY'):
        print(f"Migration {MIGRATION_ID}: PLANNER_SECRET_KEY not set. Cannot decrypt PATs.")
        return
    
    data_dir = root / 'data'
    # Create storage using diskcache backend (where accounts are stored)
    storage = create_storage(
        backend="diskcache",
        serializer="raw",
        data_dir=str(data_dir / 'cache')
    )
    
    print(f"Migration {MIGRATION_ID} DOWNGRADE: Decrypting PATs to plaintext")
    print("WARNING: This will store PATs in plaintext!")
    
    namespaces = ['accounts', 'accounts_admin']
    total_updated = 0
    
    for namespace in namespaces:
        try:
            keys = list(storage.list_keys(namespace))
        except Exception:
            continue
        
        for key in keys:
            try:
                account = storage.load(namespace, key)
            except Exception:
                continue
            
            pat = account.get('pat')
            if not pat:
                continue
            
            # Try to decrypt - if it fails, it's probably already plaintext
            try:
                plaintext_pat = _decrypt_pat(pat)
            except Exception:
                # Already plaintext or invalid
                continue
            
            print(f"    {namespace}/{key}: decrypting PAT")
            
            if dry_run:
                print(f"      [DRY-RUN] Would decrypt PAT for {key}")
                total_updated += 1
                continue
            
            try:
                account['pat'] = plaintext_pat
                storage.save(namespace, key, account)
                print(f"      ✓ Decrypted PAT for {key}")
                total_updated += 1
            except Exception as e:
                print(f"      ✗ Failed to decrypt PAT for {key}: {e}")
    
    if dry_run:
        print(f"\n[DRY-RUN] Would decrypt {total_updated} PAT(s)")
    else:
        print(f"\n✓ Downgrade complete: decrypted {total_updated} PAT(s)")
