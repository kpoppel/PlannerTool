import yaml
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

CONFIG_PATH = Path("data/config")


def load_yaml_file(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _resolve_database_path() -> Path:
    """Determine the path to the database YAML file.

    Priority:
    - If the setup module has a loaded config and contains `database_file`
      or `database_path`, use that value. If it's a relative path, resolve
      it relative to `CONFIG_PATH`.
    - Otherwise, attempt to read `server_config.yml` for the same keys.
    - Finally, fall back to `CONFIG_PATH / 'database.yaml'`.
    """
    default = CONFIG_PATH / "database.yaml"
    # Prefer the loaded server config via planner_lib.setup; otherwise use default
    try:
        from planner_lib.setup import get_property
        db_path_val = get_property('database_path')
        if db_path_val:
            p = Path(str(db_path_val))
            if not p.is_absolute():
                p = (CONFIG_PATH / p).resolve()
            # If the provided path looks like a directory or doesn't have a YAML
            # extension, append the expected filename so we load the YAML file.
            if p.is_dir() or p.suffix.lower() not in ('.yml', '.yaml'):
                p = p / 'database.yaml'
            return p
    except Exception:
        # If planner_lib.setup is not available or has no loaded config,
        # fall back to the default location.
        pass

    return default


def load_cost_config() -> dict:
    """Load cost configuration from `data/config/cost_config.yml` and `database.yaml`.
    Returns a combined dict with keys 'cost' and 'database'.
    """
    cost_cfg = load_yaml_file(CONFIG_PATH / "cost_config.yml")
    db_path = _resolve_database_path()
    db_cfg = load_yaml_file(db_path)
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
        logger.debug('Database YAML at %s did not contain expected "database" key', db_path)
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
            server_cfg = load_yaml_file(CONFIG_PATH / 'server_config.yml')
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
