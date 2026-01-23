from __future__ import annotations
import logging
from pathlib import Path
import yaml
from typing import Optional


def configure_logging(config_path: Optional[Path] = None) -> logging.Logger:
    """Configure root logging for the application.

    This mirrors the previous inline setup in `planner.py`: it establishes
    an early NOTSET basic config to allow reading the server config and then
    reconfigures the root logger to the desired default level. The function
    returns a module logger for the caller.
    """
    # Minimal early config so other imports can emit without error
    logging.basicConfig(level=logging.NOTSET, format='%(asctime)s INFO %(message)s')
    DEFAULT_LOG_LEVEL = logging.WARNING

    cfg_path = config_path or Path('data/config/server_config.yml')
    if cfg_path.exists():
        try:
            with cfg_path.open('r', encoding='utf-8') as _f:
                _cfg = yaml.safe_load(_f) or {}
                _lvl = _cfg.get('log_level')
                if _lvl:
                    DEFAULT_LOG_LEVEL = getattr(logging, _lvl.upper())  # pyright: ignore[reportOptionalMemberAccess]
        except Exception:
            # If config parse fails, fall back to default level
            DEFAULT_LOG_LEVEL = logging.WARNING

    logging.log(100, f'[planner]: Log level set to: {logging.getLevelName(DEFAULT_LOG_LEVEL)}')

    # Reconfigure root handlers to use the selected level and format
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)
    logging.basicConfig(level=DEFAULT_LOG_LEVEL, format='%(asctime)s %(levelname)s [%(name)s]: %(message)s')
    logger = logging.getLogger(__name__)

    # Keep known noisy libraries quiet by default
    logging.getLogger('azure.devops.client').setLevel(logging.WARNING)
    logging.getLogger('azure').setLevel(logging.WARNING)
    logging.getLogger('msrest').setLevel(logging.WARNING)
    logging.getLogger('requests').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logger.info("Starting AZ Planner Server")

    return logger
