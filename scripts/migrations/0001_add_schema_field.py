"""Add `schema: 1` to scenario files and record schema for pickled user files.

Behavior:
- Scenario YAML/JSON files under `data/scenarios` will get a top-level `schema: 1` if missing.
- `data/scenarios/scenario_register` will be parsed as JSON or YAML and updated similarly.
- Pickled user files (files under `data/users` with `.pkl`) will not be rewritten; instead a
  small metadata file `<name>.pkl.meta.json` will be written containing `{"schema": 1}`.

The migration supports dry-run and backup. Dry-run will print what would change.
"""

MIGRATION_ID = '0001.add-schema-field-to-scenarios-and-users'

def _is_yaml_text(text: str) -> bool:
    return ':' in text or '\n' in text


def upgrade(dry_run=False, backup=False):
    from pathlib import Path
    import json
    try:
        import yaml
    except Exception:
        yaml = None

    root = Path(__file__).resolve().parents[2]
    data_dir = root / 'data'
    scenarios_dir = data_dir / 'scenarios'
    users_dir = data_dir / 'users'
    changes = []

    # 1) Scenario files
    if scenarios_dir.exists():
        for p in scenarios_dir.rglob('*'):
            if p.is_dir():
                continue
            # try JSON first
            try:
                text = p.read_text(encoding='utf8')
            except UnicodeDecodeError:
                # skip binary files
                continue
            parsed = None
            used_yaml = False
            try:
                parsed = json.loads(text)
            except Exception:
                if yaml:
                    try:
                        parsed = yaml.safe_load(text)
                        used_yaml = True
                    except Exception:
                        parsed = None
            if isinstance(parsed, dict):
                if 'schema' not in parsed:
                    changes.append(('scenario_file', str(p)))
                    if not dry_run:
                        if backup:
                            bak = p.with_suffix(p.suffix + '.bak')
                            p.rename(bak)
                            print(f"Backed up {p} -> {bak}")
                            # read from bak to ensure content preserved for write
                            content = bak.read_text(encoding='utf8')
                        parsed['schema'] = 1
                        out_text = json.dumps(parsed, indent=2) if not used_yaml else yaml.safe_dump(parsed)
                        p.write_text(out_text, encoding='utf8')
                        print(f"Wrote schema=1 to {p}")
            else:
                # skip binary or unknown formats
                continue

    # 2) scenario_register (file without extension)
    reg = scenarios_dir / 'scenario_register.pkl'
    if reg.exists() and reg.is_file():
        try:
            text = reg.read_text(encoding='utf8')
        except UnicodeDecodeError:
            text = None
        parsed = None
        try:
            parsed = json.loads(text)
        except Exception:
            if yaml:
                try:
                    parsed = yaml.safe_load(text)
                except Exception:
                    parsed = None
        if isinstance(parsed, dict):
            if 'schema' not in parsed:
                changes.append(('scenario_register', str(reg)))
                if not dry_run:
                    if backup:
                        bak = reg.with_suffix('.bak')
                        reg.rename(bak)
                        print(f"Backed up {reg} -> {bak}")
                    parsed['schema'] = 1
                    out_text = json.dumps(parsed, indent=2) if not yaml else yaml.safe_dump(parsed)
                    reg.write_text(out_text, encoding='utf8')
                    print(f"Wrote schema=1 to {reg}")

    # 3) pickled files anywhere under data/ - rewrite to embed schema
    import pickle
    import tempfile
    import os
    for p in data_dir.rglob('*.pkl'):
        # skip backup files we may have created earlier
        if p.name.endswith('.bak'):
            continue
        # Only target scenario pickles and config user pickles matching patterns
        try:
            rel = p.relative_to(data_dir)
        except Exception:
            continue
        parts = rel.parts
        # accept files under scenarios/
        if parts[0] == 'scenarios':
            pass
        elif parts[0] == 'config':
            # require '@' in filename or __admin_user__.pkl
            if ('@' not in p.name) and (p.name != '__admin_user__.pkl'):
                continue
        else:
            continue
        try:
            with p.open('rb') as f:
                obj = pickle.load(f)
        except Exception as e:
            # cannot load pickle; skip with info
            print(f"Skipping {p}: cannot unpickle ({e})")
            continue

        # idempotency: skip if already has schema
        if isinstance(obj, dict) and 'schema' in obj:
            continue

        # We only handle mapping (dict) pickles: add schema as a top-level field.
        if not isinstance(obj, dict):
            print(f"Skipping {p}: pickled object is not a mapping; cannot add top-level schema without wrapping")
            continue

        changes.append(('pickle', str(p)))
        if dry_run:
            continue

        # add schema field directly
        obj['schema'] = 1
        tmpf = None
        bak = None
        try:
            fd, tmpf = tempfile.mkstemp(prefix=p.name + '.', dir=str(p.parent))
            with os.fdopen(fd, 'wb') as tf:
                pickle.dump(obj, tf, protocol=pickle.HIGHEST_PROTOCOL)

            # atomic replace, with optional backup
            if backup and p.exists():
                bak = p.with_name(p.name + '.bak')
                p.rename(bak)
                print(f"Backed up {p} -> {bak}")

            os.replace(tmpf, str(p))
            print(f"Updated pickle with schema field: {p}")

            # also write sidecar metadata for quick checks
            meta = p.with_name(p.name + '.meta.json')
            meta.write_text(json.dumps({'schema': 1}, indent=2), encoding='utf8')
        except Exception as e:
            print(f"Failed to update {p}: {e}")
            # cleanup tmp and try to restore backup if present
            if tmpf and os.path.exists(tmpf):
                try:
                    os.remove(tmpf)
                except Exception:
                    pass
            if backup and bak and bak.exists():
                try:
                    bak.rename(p)
                except Exception:
                    pass
            raise

    if dry_run:
        if not changes:
            print("No files need schema updates")
        else:
            print("Dry-run: the following files would be changed:")
            for kind, path in changes:
                print(f" - {kind}: {path}")
    else:
        if not changes:
            print("Nothing to change; all files already have schema field or metadata")
