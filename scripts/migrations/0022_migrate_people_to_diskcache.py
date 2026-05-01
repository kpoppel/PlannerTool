"""Migrate people.yml into diskcache.

Reads ``data/config/people.yml`` (including any external ``database_file``
reference) and writes the merged people list into the diskcache store under
``config::people``.

After this migration ``ConfigBackend.fetch_people`` reads exclusively from
diskcache — the ``yaml_storage`` fallback path is removed.

The ``people.yml`` file is preserved on disk as a human-readable archive but
is no longer read at runtime.

Behaviour
---------
- Idempotent: skipped when ``config::people`` already exists in diskcache.
- ``dry_run=True`` prints planned actions without writing anything.

people.yml shape
----------------
The YAML file may contain two sections:

  database:
    people:
      - name: Alice, external: false, team_name: Team A, site: LY

  database_file: /path/to/external/database.yaml   # optional

The external file (``database_file``) has the same ``database.people`` list
under a ``database`` key.  Inline ``database.people`` entries override
external ones by name.
"""

MIGRATION_ID = '0022.migrate-people-to-diskcache'


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import sys
    import yaml

    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))

    try:
        from planner_lib.storage import create_storage
    except ImportError as e:
        print(f'Migration {MIGRATION_ID}: failed to import planner_lib: {e}')
        raise

    config_dir = root / 'data' / 'config'
    cache_dir = root / 'data' / 'cache'
    yaml_path = config_dir / 'people.yml'

    storage = create_storage(
        backend='diskcache',
        serializer='raw',
        data_dir=str(cache_dir),
    )

    if storage.exists('config', 'people'):
        print(f'Migration {MIGRATION_ID}: SKIP — config::people already in diskcache (idempotent)')
        return

    if not yaml_path.exists():
        print(f'Migration {MIGRATION_ID}: SKIP — {yaml_path} not found; writing empty people list')
        if not dry_run:
            storage.save('config', 'people', {'database': {'people': []}})
        return

    cfg = yaml.safe_load(yaml_path.read_text(encoding='utf-8')) or {}

    # Load external database file if referenced
    people_from_file: list = []
    database_file = cfg.get('database_file', '')
    if database_file:
        db_path = Path(database_file)
        if not db_path.is_absolute():
            db_path = root / 'data' / db_path
        if db_path.exists():
            try:
                ext = yaml.safe_load(db_path.read_text(encoding='utf-8')) or {}
                people_from_file = (ext.get('database') or {}).get('people') or []
                print(f'  Loaded {len(people_from_file)} people from external file: {db_path}')
            except Exception as exc:
                print(f'  WARNING: could not load external database_file {db_path}: {exc}')
        else:
            print(f'  WARNING: database_file not found: {db_path}')

    # Inline entries override by name
    overrides: list = (cfg.get('database') or {}).get('people') or []
    people_map: dict = {p['name']: p for p in people_from_file if p.get('name')}
    for p in overrides:
        if p.get('name'):
            people_map[p['name']] = p

    merged = list(people_map.values())
    print(f'Migration {MIGRATION_ID}: merging {len(merged)} people records into diskcache')

    if dry_run:
        print(f'  DRY RUN — would write config::people ({len(merged)} records)')
        return

    # Write the merged people list in the same envelope shape as the old YAML
    # so ConfigBackend.fetch_people only needs a trivial read.
    storage.save('config', 'people', {'database': {'people': merged}})
    print(f'Migration {MIGRATION_ID}: done — {len(merged)} people written to config::people')
