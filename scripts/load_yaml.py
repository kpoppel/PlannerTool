# load_yaml.py
import yaml
from pprint import pprint
from pathlib import Path

CONFIG_PATH = Path("data/config/server_config.yml")  # or absolute path

def load_yaml(path: Path):
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data
    except FileNotFoundError:
        print(f"Config file not found: {path}")
    except yaml.YAMLError as e:
        print(f"YAML parsing error: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")
    return None

def main():
    cfg = load_yaml(CONFIG_PATH)
    if cfg is None:
        return

    print("Top-level keys:")
    pprint(list(cfg.keys()))

    print("\nProject map (name -> area_path):")
    for p in cfg.get("project_map", []):
        name = p.get("name")
        area = p.get("area_path")
        wiql = p.get("wiql")
        print(f"- {name!r} -> {area!r} (WIQL: {wiql})")

    # Example: read azure URL
    print("\nAzure DevOps URL:", cfg.get("azure_devops_url"))

if __name__ == "__main__":
    main()