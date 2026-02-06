"""Bootstrap helpers for PlannerTool startup.

This module contains a small helper to perform one-time bootstrapping
operations such as ensuring `server_config` exists and creating the
`AzureService` client. Factoring this out keeps `planner_lib.main` focused
on composing services and building the FastAPI application.
"""
from typing import Any, Tuple


def bootstrap_server(storage_yaml, logger) -> dict:
    """Ensure `server_config` exists and return server_cfg.

    Parameters
    - storage_yaml: ValueNavigatingStorage or StorageBackend used for YAML configs
    - logger: logger instance for informational messages

    Returns server_cfg dictionary loaded from storage_yaml.
    """
    try:
        if not storage_yaml.exists('config', 'server_config'):
            logger.info("server_config missing; creating default server_config.yml")
            default_cfg = {
                'schema_version': 2,
                'azure_devops_organization': None,
                'log_level': 'INFO',
                'feature_flags': {},
            }
            storage_yaml.save('config', 'server_config', default_cfg)
        server_cfg = storage_yaml.load('config', 'server_config')
    except KeyError:
        logger.exception('Failed to load or create server_config; using empty config')
        server_cfg = {}

    return server_cfg
