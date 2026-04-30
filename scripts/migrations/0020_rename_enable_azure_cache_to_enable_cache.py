"""Rename feature flag 'enable_azure_cache' to 'enable_cache' in server_config.yml.

The flag was renamed because CachingBackend now wraps all backend types
(not only Azure DevOps), so 'enable_azure_cache' was misleadingly specific.

Required from version: 3.6.0

Behaviour
---------
- Renames the key ``enable_azure_cache`` → ``enable_cache`` inside
  ``feature_flags`` of ``data/config/server_config.yml``.
- If ``enable_cache`` already exists (e.g. the operator edited the file
  manually) the old ``enable_azure_cache`` entry is simply removed.
- If neither key exists the migration is a no-op.
- Supports ``dry_run`` (print what would change without writing) and
  ``backup`` (copy file to .bak before modifying).
"""

MIGRATION_ID = '0020.rename-enable-azure-cache-to-enable-cache'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import yaml

    root = Path(__file__).resolve().parents[2]
    config_file = root / 'data' / 'config' / 'server_config.yml'

    if not config_file.exists():
        print(f"Migration {MIGRATION_ID}: config file not found: {config_file} — skipping")
        return

    try:
        data = yaml.safe_load(config_file.read_text(encoding='utf-8')) or {}
    except yaml.YAMLError as exc:
        print(f"Migration {MIGRATION_ID}: failed to parse YAML: {exc}")
        return

    feature_flags = data.get('feature_flags', {})

    if 'enable_azure_cache' not in feature_flags:
        print(f"Migration {MIGRATION_ID}: 'enable_azure_cache' not present — nothing to do")
        return

    old_value = feature_flags['enable_azure_cache']

    if 'enable_cache' in feature_flags:
        # Operator already has the new key; just remove the stale old one.
        action = f"  Remove 'enable_azure_cache' (enable_cache already present with value {feature_flags['enable_cache']!r})"
    else:
        action = f"  Rename 'enable_azure_cache: {old_value!r}' → 'enable_cache: {old_value!r}'"

    print(f"Migration {MIGRATION_ID}: {action}")

    if dry_run:
        print("  (dry-run: no changes written)")
        return

    if backup:
        import shutil
        bak = config_file.with_suffix(config_file.suffix + '.bak')
        shutil.copy2(config_file, bak)
        print(f"  Backed up {config_file} → {bak}")

    # Apply change
    del feature_flags['enable_azure_cache']
    if 'enable_cache' not in feature_flags:
        feature_flags['enable_cache'] = old_value
    data['feature_flags'] = feature_flags

    import re
    yaml_content = yaml.dump(data, default_flow_style=False, sort_keys=False, indent=2)
    # Insert a comment before the feature_flags block for clarity
    yaml_content, _ = re.subn(
        r'(?m)^(feature_flags:)',
        '# Feature flags — enable_azure_cache was renamed to enable_cache in v3.6.0\n\\1',
        yaml_content,
        count=1,
    )

    config_file.write_text(yaml_content, encoding='utf-8')
    print(f"Migration {MIGRATION_ID}: updated {config_file}")


def downgrade(dry_run=False, backup=False):
    """Revert: rename 'enable_cache' back to 'enable_azure_cache'."""
    from pathlib import Path
    import yaml

    root = Path(__file__).resolve().parents[2]
    config_file = root / 'data' / 'config' / 'server_config.yml'

    if not config_file.exists():
        print(f"Migration {MIGRATION_ID}: config file not found — skipping downgrade")
        return

    try:
        data = yaml.safe_load(config_file.read_text(encoding='utf-8')) or {}
    except yaml.YAMLError as exc:
        print(f"Migration {MIGRATION_ID}: failed to parse YAML: {exc}")
        return

    feature_flags = data.get('feature_flags', {})

    if 'enable_cache' not in feature_flags:
        print(f"Migration {MIGRATION_ID}: 'enable_cache' not present — nothing to revert")
        return

    print(f"Migration {MIGRATION_ID}: reverting 'enable_cache' → 'enable_azure_cache'")

    if dry_run:
        print("  (dry-run: no changes written)")
        return

    if backup:
        import shutil
        bak = config_file.with_suffix(config_file.suffix + '.bak')
        shutil.copy2(config_file, bak)
        print(f"  Backed up {config_file} → {bak}")

    old_value = feature_flags.pop('enable_cache')
    feature_flags['enable_azure_cache'] = old_value
    data['feature_flags'] = feature_flags

    yaml_content = yaml.dump(data, default_flow_style=False, sort_keys=False, indent=2)
    config_file.write_text(yaml_content, encoding='utf-8')
    print(f"Migration {MIGRATION_ID}: reverted {config_file}")
