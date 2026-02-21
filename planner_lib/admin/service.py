"""AdminService: lightweight service for admin-related operations.

This mirrors the style of other services in `planner_lib/projects` and is
constructed in `main.create_app` with explicit storage and service
dependencies.
"""
from typing import Any
import logging

from planner_lib.services.interfaces import StorageProtocol
from planner_lib.services.resolver import resolve_service

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
            try:
                cfg = self._config_storage.load('config', 'server_config') or {}
            except KeyError:
                cfg = {}
            self._azure_client.organization_url = cfg.get('azure_devops_organization')
            self._azure_client.feature_flags = cfg.get('feature_flags')
            # Best-effort: call reload/invalidate hooks on other services
            try:
                if request is not None:
                    # People service has a reload() method
                    try:
                        people = resolve_service(request, 'people_service')
                        if hasattr(people, 'reload'):
                            people.reload()
                    except Exception:
                        logger.debug('No people_service reload available')

                    # Cost service has invalidate_cache() method
                    try:
                        cost = resolve_service(request, 'cost_service')
                        cost.invalidate_cache()
                        logger.debug('Cost service cache invalidated')
                    except Exception as e:
                        logger.debug('No cost_service available to invalidate: %s', e)

                    # Team/project/capacity services may implement reload
                    for svc_name in ('team_service', 'project_service', 'capacity_service'):
                        try:
                            svc = resolve_service(request, svc_name)
                            if hasattr(svc, 'reload'):
                                svc.reload()
                        except Exception:
                            logger.debug('No %s.reload available', svc_name)
            except Exception:
                logger.debug('Error while invoking service reload hooks')
            return {'ok': True}
        except Exception as e:
            logger.exception('Failed to reload configuration: %s', e)
            raise
