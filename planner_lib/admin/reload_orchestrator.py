"""ReloadOrchestrator: handles config-reload side-effects after an admin save.

This was previously inlined in AdminService.reload_config() which forced
AdminService to accept references to every service in the application.
Extracting it here keeps AdminService focused on its core role (config CRUD,
account management) and makes the reload logic independently testable.

Storage split
-------------
``config_storage`` (diskcache) holds all config keys except ``server_config``.
``server_config_storage`` (YAML) holds ``server_config`` and ``ado_config`` is
read from ``config_storage`` to refresh the AzureService org URL and ADO flags.
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
    the freshly-loaded ``ado_config`` and rebuilds its concrete client when
    feature flags change.
    """

    def __init__(
        self,
        config_storage: StorageBackend,
        azure_client: Any,
        account_manager: Any,
        reloadable_services: list,
        server_config_storage: Optional[StorageBackend] = None,
    ) -> None:
        """
        Args:
            config_storage: diskcache-backed storage holding all config keys
                except server_config.
            azure_client: The AzureService instance whose settings are refreshed.
            account_manager: AccountManager used to refresh session credentials.
            reloadable_services: List of service instances to reload/invalidate.
                Each service is tested for Reloadable / Invalidatable protocols.
            server_config_storage: Optional YAML-backed storage for server_config.
                Falls back to config_storage when not provided.
        """
        self._config_storage = config_storage
        self._server_config_storage = server_config_storage or config_storage
        self._azure_client = azure_client
        self._account_manager = account_manager
        self._reloadable_services = reloadable_services

    def reload(self, session_id: str = '') -> dict:
        """Reload configuration and refresh all registered services.

        Returns ``{"ok": True}`` on success; raises on unexpected error.
        """
        # Snapshot the active backend class *before* rebuilding so we can
        # detect a backend-type switch and invalidate stale cached data.
        old_backend_class = type(self._azure_client._client) if self._azure_client is not None else None

        # Update azure_client runtime settings from ado_config (diskcache).
        try:
            ado_cfg = self._config_storage.load('config', 'ado_config') or {}
        except KeyError:
            ado_cfg = {}
        self._azure_client.organization_url = ado_cfg.get('organization_url') or ''
        # Merge generic feature_flags (server_config) + ADO-specific flags (ado_config).
        try:
            server_cfg = self._server_config_storage.load('config', 'server_config') or {}
        except KeyError:
            server_cfg = {}
        merged_flags = {**(server_cfg.get('feature_flags') or {}), **(ado_cfg.get('feature_flags') or {})}
        self._azure_client.feature_flags = merged_flags
        # Rebuild the concrete client so feature-flag changes take effect.
        self._azure_client.rebuild_client()

        new_backend_class = type(self._azure_client._client)
        if old_backend_class is not None and new_backend_class is not old_backend_class:
            logger.info(
                'ReloadOrchestrator: ADO backend changed %s → %s; invalidating domain cache',
                old_backend_class.__name__, new_backend_class.__name__,
            )
            for svc in self._reloadable_services:
                if isinstance(svc, Invalidatable):
                    try:
                        svc.invalidate_cache()
                    except Exception as exc:
                        logger.warning('ReloadOrchestrator: invalidate_cache failed on %s: %s', type(svc).__name__, exc)

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
