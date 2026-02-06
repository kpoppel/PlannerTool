"""AdminService: lightweight service for admin-related operations.

This mirrors the style of other services in `planner_lib/projects` and is
constructed in `main.create_app` with explicit storage and service
dependencies.
"""
from typing import Any
import logging

from planner_lib.services.interfaces import StorageProtocol

logger = logging.getLogger(__name__)


class AdminService:
    """Service exposing admin helpers.

    The service delegates to provided storage backends and other services
    passed at construction time.
    """

    def __init__(
        self,
        account_storage: StorageProtocol,
        config_storage: StorageProtocol,
        team_service: Any,
        project_service: Any,
        account_manager: Any,
        azure_client: Any,
    ) -> None:
        self._account_storage = account_storage
        self._config_storage = config_storage
        self._team_service = team_service
        self._project_service = project_service
        self._account_manager = account_manager
        self._azure_client = azure_client

    def is_admin(self, email: str) -> bool:
        """Return True when `data/accounts_admin/<email>` exists."""
        try:
            return bool(self._account_storage.exists('accounts_admin', email))
        except Exception:
            return False

    def reload_config(self, request=None) -> dict:
        """Reload configuration artifacts touched by the admin UI.

        This method attempts
        to touch server config and cost/database config keys so in-memory
        caches can be refreshed by callers.
        """
        try:
            try:
                cfg = self._config_storage.load('config', 'server_config')
                # Some modules keep a module-level cache; best-effort clear.
                try:
                    from planner_lib import setup as setup_module

                    if hasattr(setup_module, '_loaded_config'):
                        setup_module._loaded_config.clear()
                        setup_module._loaded_config.append(cfg)
                except Exception:
                    logger.debug('No setup._loaded_config to refresh')
            except Exception:
                logger.debug('No server config present to reload')

            # Touch cost_config and database keys
            try:
                _ = self._config_storage.load('config', 'cost_config') or {}
            except Exception:
                logger.debug('No cost_config present to reload')
            try:
                _ = self._config_storage.load('config', 'database') or {}
            except Exception:
                logger.debug('No database config present to reload')

            # If the cost engine exposes an invalidation hook, call it.
            try:
                from planner_lib.cost import engine as cost_engine

                if hasattr(cost_engine, 'invalidate_team_rates_cache'):
                    cost_engine.invalidate_team_rates_cache()
            except Exception:
                logger.debug('No cost engine available to invalidate cache')

            # Reload account for the current session if present
            try:
                if request is not None:
                    sid = request.cookies.get('session') or ''
                    self._account_manager.load(sid)
            except Exception:
                logger.debug('Failed to refresh account for session')

            # Update composed azure_client runtime settings from the new
            # server configuration so future Azure connections use the
            # updated organization and feature flags.
            cfg = self._config_storage.load('config', 'server_config') or {}
            self._azure_client.organization_url = cfg.get('azure_devops_organization')
            self._azure_client.feature_flags = cfg.get('feature_flags')
            return {'ok': True}
        except Exception as e:
            logger.exception('Failed to reload configuration: %s', e)
            raise
