"""AdminService: lightweight service for admin-related operations.

This mirrors the style of other services in `planner_lib/projects` and is
constructed in `main.create_app` with explicit storage and service
dependencies.
"""
from typing import Any, Optional
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
        views_storage: Optional[StorageProtocol] = None,
        scenarios_storage: Optional[StorageProtocol] = None,
    ) -> None:
        self._account_storage = account_storage
        self._config_storage = config_storage
        self._team_service = team_service
        self._project_service = project_service
        self._account_manager = account_manager
        self._azure_client = azure_client
        # Optional separate storages for views/scenarios (may use pickle serializer)
        self._views_storage = views_storage
        self._scenarios_storage = scenarios_storage

    def is_admin(self, email: str) -> bool:
        """Return True when `data/accounts_admin/<email>` exists."""
        try:
            return bool(self._account_storage.exists('accounts_admin', email))
        except Exception:
            return False

    def get_backup(self):
        """Create a backup of all configuration and data."""
        backup_data = {
            "config": {},
            "accounts": {},
            "views": {},
            "scenarios": {},
        }

        # Backup configuration files
        config_keys = [
            "projects", "teams", "people", "cost_config", 
            "area_plan_map", "iterations", "server_config"
        ]
        for key in config_keys:
            try:
                backup_data["config"][key] = self._config_storage.load('config', key)
            except KeyError:
                backup_data["config"][key] = None

        # Backup user accounts and admins
        try:
            users = {}
            for user_key in self._account_storage.list_keys('accounts'):
                users[user_key] = self._account_storage.load('accounts', user_key)

            admins = {}
            for admin_key in self._account_storage.list_keys('accounts_admin'):
                admins[admin_key] = self._account_storage.load('accounts_admin', admin_key)

            backup_data["accounts"] = {"users": users, "admins": admins}
        except Exception as e:
            logger.error(f"Failed to backup accounts: {e}")
            backup_data["accounts"] = {"users": {}, "admins": {}}

        # Backup views (use dedicated views storage when available)
        try:
            storage = self._views_storage or self._config_storage
            view_keys = list(storage.list_keys('views') or [])
            for key in view_keys:
                try:
                    backup_data["views"][key] = storage.load('views', key)
                except Exception as e:
                    logger.error("Failed to backup view %s: %s", key, e)
        except Exception as e:
            logger.error("Failed to list views for backup: %s", e)

        # Backup scenarios (use dedicated scenarios storage when available)
        try:
            storage = self._scenarios_storage or self._config_storage
            scenario_keys = list(storage.list_keys('scenarios') or [])
            for key in scenario_keys:
                try:
                    backup_data["scenarios"][key] = storage.load('scenarios', key)
                except Exception as e:
                    logger.error("Failed to backup scenario %s: %s", key, e)
        except Exception as e:
            logger.error("Failed to list scenarios for backup: %s", e)
            
        return backup_data

    def restore_backup(self, data, current_user_email=None):
        """Restore data from a backup."""
        if "config" in data:
            for key, content in data["config"].items():
                if content is not None:
                    self._config_storage.save('config', key, content)

        if "accounts" in data:
            users = data["accounts"].get("users", {})
            admins = data["accounts"].get("admins", {})
            
            # Prevent current admin from being removed
            if current_user_email and current_user_email in self.get_all_admins() and current_user_email not in admins:
                raise ValueError("Cannot remove the current admin account.")

            # Restore users and admins
            self.sync_accounts_full(users, admins)

        if "views" in data:
            storage = self._views_storage or self._config_storage
            for key, content in data["views"].items():
                storage.save('views', key, content)
        
        if "scenarios" in data:
            storage = self._scenarios_storage or self._config_storage
            for key, content in data["scenarios"].items():
                storage.save('scenarios', key, content)

        return {"ok": True, "message": "Restore completed successfully."}

    def get_all_admins(self):
        """Returns a list of all admin emails."""
        try:
            return list(self._account_storage.list_keys('accounts_admin'))
        except Exception:
            return []

    def sync_accounts_full(self, users, admins):
        """Synchronize user and admin accounts with full data."""
        current_users = set(self._account_storage.list_keys('accounts') or [])
        current_admins = set(self._account_storage.list_keys('accounts_admin') or [])
        incoming_users = set(users.keys())
        incoming_admins = set(admins.keys())

        # Add/update users
        for user_key, user_data in users.items():
            self._account_storage.save('accounts', user_key, user_data)

        # Remove users
        for user_key in current_users - incoming_users:
            self._account_storage.delete('accounts', user_key)

        # Add/update admins
        for admin_key, admin_data in admins.items():
            self._account_storage.save('accounts_admin', admin_key, admin_data)
        
        # Remove admins
        for admin_key in current_admins - incoming_admins:
            self._account_storage.delete('accounts_admin', admin_key)


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
