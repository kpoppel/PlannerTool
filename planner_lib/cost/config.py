import logging
from typing import Any

from planner_lib.storage import create_storage
from planner_lib.storage.serializer import YAMLSerializer

logger = logging.getLogger(__name__)

# Use the storage abstraction for reading YAML config files under the
# `config` namespace. We prefer a YAML serializer so the storage `load`
# returns parsed Python objects.
_storage = create_storage(backend="file", serializer="yaml", accessor=None, data_dir="data")
_CONFIG_NS = "config"

def load_yaml_file_from_storage(key: str) -> dict:
    try:
        data = _storage.load(_CONFIG_NS, key)
        # Serializer returns Python objects already (YAMLSerializer.load)
        if isinstance(data, dict):
            return data
        return data or {}
    except KeyError:
        return {}
    except Exception:
        logger.exception("Failed to load config %s from storage", key)
        return {}


def _resolve_database_path() -> str:
    """Determine the path to the database YAML file.

    Priority:
    - If the setup module has a loaded config and contains `database_file`
      or `database_path`, use that value. If it's a relative path, resolve
      it relative to `CONFIG_PATH`.
    - Otherwise, attempt to read `server_config.yml` for the same keys.
    - Finally, fall back to `CONFIG_PATH / 'database.yaml'`.
    """
    # Under the storage model we expect the database YAML to be stored as
    # the key `database.yaml` in the `config` namespace. If `planner_lib.setup`
    # provides an override via `database_path` we interpret it as a storage
    # key (either filename or directory). We return the storage key string
    # rather than a filesystem Path because callers will read via storage.
    try:
        from planner_lib.setup import get_property
        db_path_val = get_property("database_path")
        if db_path_val:
            # If the configured value looks like a filename without YAML
            # extension, append the expected filename.
            db_key = str(db_path_val)
            if db_key.endswith("/") or not (db_key.lower().endswith('.yml') or db_key.lower().endswith('.yaml')):
                # treat as directory-like -> append filename
                db_key = db_key.rstrip('/') + '/database.yaml'
            return db_key
    except Exception:
        pass

    return "database.yaml"


def load_cost_config() -> dict:
    """Load cost configuration from `data/config/cost_config.yml` and `database.yaml`.
    Returns a combined dict with keys 'cost' and 'database'.
    """
    cost_cfg = load_yaml_file_from_storage("cost_config.yml")
    db_key = _resolve_database_path()
    # `_resolve_database_path` returns a storage key (string); ensure it's str
    db_cfg = load_yaml_file_from_storage(str(db_key))
    # Validate consistency between server/team config and database people
    try:
        _validate_team_consistency(cost_cfg, db_cfg)
    except Exception as e:
        # Log the configuration consistency error so it is visible during
        # startup. Do not raise here to allow the server to start in
        # environments where strict validation is not desired.
        logger.warning("Cost configuration validation failed: %s", e)
    # Ensure we always return a dict for the 'database' key
    database = {}
    if isinstance(db_cfg, dict) and isinstance(db_cfg.get('database'), dict):
        database = db_cfg.get('database')
    else:
        logger.debug('Database YAML at %s did not contain expected "database" key', db_key)
    return {"cost": cost_cfg, "database": database}


def _validate_team_consistency(cost_cfg: dict, db_cfg: dict) -> None:
    """Ensure teams declared in server config `team_map` are used by people in `database`.

    Raises ValueError if inconsistencies are found. The check builds the canonical
    set of team ids from `team_map` (slugified as `team-<slug>`) and the set of
    team ids present in people entries (slugified similarly). If some configured
    teams are not referenced by any person, this function raises a ValueError
    listing the missing team names.
    """
    from planner_lib.util import slugify

    # Extract configured team names from cost_cfg/ or server config structure
    configured = []
    # cost_cfg may contain a server-like structure with 'team_map'
    if isinstance(cost_cfg, dict) and cost_cfg.get('team_map'):
        for t in cost_cfg.get('team_map'): # type: ignore
            if isinstance(t, dict) and t.get('name'):
                configured.append(str(t.get('name')))

    # If cost_cfg did not contain team_map, attempt to read server_config.yml
    # located in the same directory as database.yaml
    if not configured:
        try:
            server_cfg = load_yaml_file_from_storage('server_config.yml')
            for t in server_cfg.get('team_map', []):
                if isinstance(t, dict) and t.get('name'):
                    configured.append(str(t.get('name')))
        except Exception:
            pass

    configured_ids = set(slugify(name, prefix='team-') for name in configured if name)

    # Extract team names referenced by people
    people = (db_cfg or {}).get('database', {}).get('people', []) if isinstance(db_cfg, dict) else []
    people_team_ids = set()
    for p in people or []:
        raw = p.get('team_name') or p.get('team') or ''
        raw = str(raw).strip()
        if not raw:
            continue
        people_team_ids.add(slugify(raw, prefix='team-'))

    # Find configured but unused teams, and teams present in database but not configured
    missing_configured = sorted(list(configured_ids - people_team_ids))
    missing_in_db = sorted(list(people_team_ids - configured_ids))
    if missing_configured or missing_in_db:
        parts = []
        if missing_configured:
            human_missing = ', '.join(sorted([m.replace('team-', '') for m in missing_configured]))
            parts.append(f"configured-but-unused: {human_missing}")
        if missing_in_db:
            human_extra = ', '.join(sorted([m.replace('team-', '') for m in missing_in_db]))
            parts.append(f"in-database-but-not-configured: {human_extra}")
        raise ValueError("Team configuration mismatch: " + '; '.join(parts))
