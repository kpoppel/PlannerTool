"""Migrate pickle-based storage to diskcache backend.

This migration moves accounts, admin accounts, scenarios, and views from 
file-based pickle storage to the diskcache backend (data/cache/). The Azure 
cache is cleared and will be rebuilt on-demand.

Behavior:
- Migrates account files from data/accounts/*.pkl to diskcache namespace 'accounts'
- Migrates admin account files from data/accounts_admin/*.pkl to diskcache namespace 'accounts_admin'
- Migrates scenario files from data/scenarios/*.pkl to diskcache namespace 'scenarios'
- Migrates view files from data/views/*.pkl to diskcache namespace 'views'
- Clears Azure cache (data/azure_workitems/) - will be rebuilt on next request
- Supports dry_run to preview migration
- Supports backup to preserve original files
"""

MIGRATION_ID = '0015.migrate-pickle-to-diskcache'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import pickle
    import shutil
    
    # Check for diskcache availability
    try:
        from diskcache import Cache
    except ImportError:
        print(f"Migration {MIGRATION_ID}: diskcache module not installed")
        if dry_run:
            print("  [DRY-RUN] Would migrate pickle files to diskcache (requires 'diskcache' package)")
            return
        else:
            print("  ERROR: Install 'diskcache' package to run this migration")
            print("  Run: pip install diskcache")
            raise
    
    root = Path(__file__).resolve().parents[2]
    data_dir = root / 'data'
    cache_dir = data_dir / 'cache'
    
    print(f"Migration {MIGRATION_ID}: Starting pickle to diskcache migration")
    
    # Initialize diskcache
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = Cache(directory=str(cache_dir))
    
    # Define migration mappings: (source_dir, namespace)
    migrations = [
        (data_dir / 'accounts', 'accounts'),
        (data_dir / 'accounts_admin', 'accounts_admin'),
        (data_dir / 'scenarios', 'scenarios'),
        (data_dir / 'views', 'views'),
    ]
    
    migrated = []
    
    for source_dir, namespace in migrations:
        if not source_dir.exists():
            print(f"  Source directory {source_dir} does not exist, skipping")
            continue
        
        pkl_files = list(source_dir.glob('*.pkl'))
        if not pkl_files:
            print(f"  No pickle files found in {source_dir}")
            continue
        
        print(f"  Migrating {len(pkl_files)} files from {source_dir} to namespace '{namespace}'")
        
        for pkl_file in pkl_files:
            key = pkl_file.stem  # filename without extension
            composite_key = f"{namespace}::{key}"
            
            try:
                # Read pickle file
                with open(pkl_file, 'rb') as f:
                    data = pickle.load(f)
                
                if dry_run:
                    print(f"    [DRY RUN] Would migrate: {pkl_file.name} -> {composite_key}")
                else:
                    # Write to diskcache
                    cache.set(composite_key, data)
                    migrated.append((pkl_file, composite_key))
                    print(f"    Migrated: {pkl_file.name} -> {composite_key}")
                    
                    # Backup or remove original
                    if backup:
                        backup_file = pkl_file.with_suffix('.pkl.bak')
                        shutil.copy2(pkl_file, backup_file)
                        print(f"    Backed up: {pkl_file} -> {backup_file}")
                    pkl_file.unlink()
                    
            except Exception as e:
                print(f"    ERROR migrating {pkl_file}: {e}")
    
    # Clear Azure cache (will be rebuilt on-demand)
    azure_cache_dir = data_dir / 'azure_workitems'
    if azure_cache_dir.exists():
        if dry_run:
            print(f"  [DRY RUN] Would clear Azure cache directory: {azure_cache_dir}")
        else:
            print(f"  Clearing Azure cache directory: {azure_cache_dir}")
            try:
                shutil.rmtree(azure_cache_dir)
                print(f"  Azure cache cleared (will be rebuilt on next request)")
            except Exception as e:
                print(f"  ERROR clearing Azure cache: {e}")
    
    if not dry_run:
        print(f"\nMigration {MIGRATION_ID} complete: {len(migrated)} files migrated to diskcache")
    else:
        print(f"\nMigration {MIGRATION_ID} dry run complete")
    
    cache.close()


def downgrade(dry_run=False):
    """Revert migration by exporting diskcache data back to pickle files."""
    from pathlib import Path
    import pickle
    from diskcache import Cache
    
    root = Path(__file__).resolve().parents[2]
    data_dir = root / 'data'
    cache_dir = data_dir / 'cache'
    
    print(f"Downgrade {MIGRATION_ID}: Reverting diskcache to pickle files")
    
    if not cache_dir.exists():
        print(f"  Cache directory {cache_dir} does not exist, nothing to downgrade")
        return
    
    cache = Cache(directory=str(cache_dir))
    
    namespaces = ['accounts', 'accounts_admin', 'scenarios', 'views']
    
    for namespace in namespaces:
        target_dir = data_dir / namespace
        target_dir.mkdir(exist_ok=True)
        
        prefix = f"{namespace}::"
        keys = [k for k in cache.iterkeys() if str(k).startswith(prefix)]
        
        print(f"  Reverting {len(keys)} entries from namespace '{namespace}'")
        
        for composite_key in keys:
            key = str(composite_key).replace(prefix, '')
            pkl_file = target_dir / f"{key}.pkl"
            
            try:
                data = cache.get(composite_key)
                if dry_run:
                    print(f"    [DRY RUN] Would export: {composite_key} -> {pkl_file}")
                else:
                    with open(pkl_file, 'wb') as f:
                        pickle.dump(data, f)
                    print(f"    Exported: {composite_key} -> {pkl_file}")
                    cache.delete(composite_key)
            except Exception as e:
                print(f"    ERROR exporting {composite_key}: {e}")
    
    cache.close()
    
    if not dry_run:
        print(f"\nDowngrade {MIGRATION_ID} complete")
    else:
        print(f"\nDowngrade {MIGRATION_ID} dry run complete")
