"""ReloadOrchestrator: handles config-reload side-effects after an admin save.

This was previously inlined in AdminService.reload_config() which forced
AdminService to accept references to every service in the application.
Extracting it here keeps AdminService focused on its core role (config CRUD,
account management) and makes the reload logic independently testable.
"""
import logging
from typing import Any, Optional

from planner_lib.storage.base import StorageBackend
from planner_lib.services.interfaces import Reloadable, Invalidatable

logger = logging.getLogger(__name__)


class ReloadOrchestrator:
    """Refreshes in-memory caches for all services that support hot-reload.

    Services that implement :class:`~planner_lib.services.interfaces.Reloadable`
    have their ``reload()`` method called.  Services that only implement
    :class:`~planner_lib.services.interfaces.Invalidatable` (and not
    ``Reloadable``) have their ``invalidate_cache()`` called instead.

    The orchestrator also updates the ``AzureService`` runtime settings from
    the freshly-loaded server config and rebuilds its concrete client when
    feature flags change.
    """

    def __init__(
        self,
        config_storage: StorageBackend,
        azure_client: Any,
        account_manager: Any,
        reloadable_services: list,
    ) -> None:
        """
        Args:
            config_storage: YAML storage used to re-read server_config.
            azure_client: The AzureService instance whose settings are refreshed.
            account_manager: AccountManager used to refresh session credentials.
            reloadable_services: List of service instances to reload/invalidate.
                Each service is tested for Reloadable / Invalidatable protocols.
        """
        self._config_storage = config_storage
        self._azure_client = azure_client
        self._account_manager = account_manager
        self._reloadable_services = reloadable_services

    def reload(self, session_id: str = '') -> dict:
        """Reload configuration and refresh all registered services.

        Returns ``{"ok": True}`` on success; raises on unexpected error.
        """
        # Warm up storage reads for the keys touched by the admin UI.
        for key in ('server_config', 'cost_config', 'database'):
            try:
                self._config_storage.load('config', key)
            except Exception:
                logger.debug('Config key not present: %s', key)

        # Update azure_client runtime settings from the refreshed server config.
        try:
            cfg = self._config_storage.load('config', 'server_config') or {}
        except KeyError:
            cfg = {}
        self._azure_client.organization_url = cfg.get('azure_devops_organization')
        self._azure_client.feature_flags = cfg.get('feature_flags') or {}
        # Rebuild the concrete client so feature-flag changes take effect.
        self._azure_client._client = self._azure_client._build_client()

        # Reload / invalidate all registered services.
        for svc in self._reloadable_services:
            if isinstance(svc, Reloadable):
                try:
                    svc.reload()
                    logger.debug('Reloaded %s', type(svc).__name__)
                except Exception:
                    logger.debug('reload() failed on %s', type(svc).__name__)
            elif isinstance(svc, Invalidatable):
                try:
                    svc.invalidate_cache()
                    logger.debug('Invalidated %s', type(svc).__name__)
                except Exception as e:
                    logger.debug('invalidate_cache() failed on %s: %s', type(svc).__name__, e)

        # Refresh session credentials for the caller when session_id is provided.
        if session_id:
            try:
                self._account_manager.load(session_id)
            except Exception:
                logger.debug('Failed to refresh account for session %s', session_id)

        return {'ok': True}
