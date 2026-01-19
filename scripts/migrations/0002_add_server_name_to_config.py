"""Add `server_name: Planner Tool` to server_config.yml under data/config.

Behavior:
- If `data/config/server_config.yml` exists and does not contain `server_name`,
  add `server_name: Planner Tool` near the top of the file (after `schema_version` if present).
- Supports `dry_run` and `backup`. When `backup` is True a `.bak` copy will be created.
"""

MIGRATION_ID = '0002.add-server-name-to-config'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    config_file = root / 'data' / 'config' / 'server_config.yml'

    if not config_file.exists():
        print(f"Migration {MIGRATION_ID}: config file not found: {config_file}")
        return

    text = config_file.read_text(encoding='utf8')
    # Simple check: if server_name already present, nothing to do.
    if 'server_name:' in text:
        print(f"Migration {MIGRATION_ID}: server_name already present in {config_file}")
        return

    print(f"Migration {MIGRATION_ID}: will add server_name to {config_file}")
    if dry_run:
        return

    # Backup if requested
    if backup:
        bak = config_file.with_suffix(config_file.suffix + '.bak')
        config_file.rename(bak)
        print(f"Backed up {config_file} -> {bak}")
        text = bak.read_text(encoding='utf8')

    lines = text.splitlines()
    out_lines = []
    inserted = False

    # Insert after schema_version if present, otherwise at top
    for i, line in enumerate(lines):
        out_lines.append(line)
        if not inserted and line.strip().startswith('schema_version'):
            out_lines.append('server_name: Planner Tool')
            inserted = True

    if not inserted:
        # No schema_version found; insert at top
        out_lines.insert(0, 'server_name: Planner Tool')

    new_text = '\n'.join(out_lines) + '\n'
    config_file.write_text(new_text, encoding='utf8')
    print(f"Wrote server_name to {config_file}")
