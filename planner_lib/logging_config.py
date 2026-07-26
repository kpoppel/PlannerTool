from __future__ import annotations
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from planner_lib.storage.base import StorageBackend


def configure_logging(storage: "StorageBackend") -> logging.Logger:
    """Configure root logging for the application.

    Reads log_level from diskcache (``config::server_config``).  Falls back to
    WARNING when no config is available or the key does not exist.
    Returns a module logger for the caller.
    """
    # Minimal early config so other imports can emit without error
    logging.basicConfig(level=logging.NOTSET, format='%(asctime)s INFO %(message)s')
    DEFAULT_LOG_LEVEL = logging.WARNING

    log_level: Any = None

    try:
        server_cfg = storage.load('config', 'server_config') or {}
        log_level = server_cfg.get('log_level')
    except KeyError:
        pass

    if log_level:
        DEFAULT_LOG_LEVEL = getattr(logging, str(log_level).upper(), logging.WARNING)  # type: ignore[reportAttributeAccessIssue]

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
