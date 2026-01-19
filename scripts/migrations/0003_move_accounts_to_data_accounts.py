"""Move account pickle files from `data/config` to `data/accounts`.

Behavior:
- Finds `*.pkl` files in `data/config` that look like account files (contains '@' or named `__admin_user__.pkl`).
- Moves them to `data/accounts/` preserving filenames.
- Supports `dry_run` to list moves without performing them, and `backup` to copy originals to `.bak` before moving.
"""

MIGRATION_ID = '0003.move-accounts-to-data-accounts'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import shutil

    root = Path(__file__).resolve().parents[2]
    cfg_dir = root / 'data' / 'config'
    dest_dir = root / 'data' / 'accounts'
    moved = []

    if not cfg_dir.exists():
        print(f"Migration {MIGRATION_ID}: source config dir does not exist: {cfg_dir}")
        return

    dest_dir.mkdir(parents=True, exist_ok=True)

    for p in cfg_dir.iterdir():
        if not p.is_file():
            continue
        if not p.suffix == '.pkl':
            continue
        # Heuristic: account pickles have '@' in the name or are __admin_user__.pkl
        if ('@' in p.name) or (p.name == '__admin_user__.pkl') or p.name.endswith('.pkl'):
            target = dest_dir / p.name
            moved.append((p, target))

    if not moved:
        print(f"Migration {MIGRATION_ID}: no account pickles found in {cfg_dir}")
        return

    print(f"Migration {MIGRATION_ID}: will move {len(moved)} files from {cfg_dir} to {dest_dir}")
    for src, dst in moved:
        print(f" - {src} -> {dst}")
    if dry_run:
        return

    for src, dst in moved:
        # optional backup copy
        if backup:
            bak = src.with_suffix(src.suffix + '.bak')
            shutil.copy2(src, bak)
            print(f"Backed up {src} -> {bak}")
        # move
        src.replace(dst)
        print(f"Moved {src} -> {dst}")
