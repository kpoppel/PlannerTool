import yaml
from pathlib import Path

CONFIG_PATH = Path("data/config")


def load_yaml_file(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_cost_config() -> dict:
    """Load cost configuration from `data/config/cost_config.yml` and `database.yaml`.
    Returns a combined dict with keys 'cost' and 'database'.
    """
    cost_cfg = load_yaml_file(CONFIG_PATH / "cost_config.yml")
    db_cfg = load_yaml_file(CONFIG_PATH / "database.yaml")
    return {"cost": cost_cfg, "database": db_cfg["database"]}
