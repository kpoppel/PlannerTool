"""AdminService: lightweight service for admin-related operations.

Config CRUD (load, save, backup, restore) is delegated to the composed
:class:`~planner_lib.admin.config_manager.ConfigManager` instance.

Account / admin-marker CRUD is delegated to the composed
:class:`~planner_lib.admin.account_admin_service.AccountAdminService` instance.

Hot-reload after a config save is delegated to the composed
:class:`~planner_lib.admin.reload_orchestrator.ReloadOrchestrator` instance.
"""
from typing import Any, Optional
import logging

from planner_lib.storage.base import StorageBackend
from planner_lib.admin.config_manager import ConfigManager
from planner_lib.admin.reload_orchestrator import ReloadOrchestrator
from planner_lib.accounts.constants import AccountPermissions

logger = logging.getLogger(__name__)


class AdminService:
    """Service exposing admin helpers.

    Delegates to three composed helpers:
    - ConfigManager    : config CRUD + backup/restore
    - AccountManager : account management (users and permissions)
    - ReloadOrchestrator  : hot-reload of in-memory service caches
    """

    def __init__(
        self,
        storage: StorageBackend,  # single diskcache instance for all namespaces
        project_repository: Any,
        account_manager: Any,
        azure_client: Any,
        reloadable_services: Optional[list] = None,
    ) -> None:
        self._project_service = project_repository  # internal alias kept for brevity
        # Composed config manager: owns all config CRUD + backup/restore.
        self._config_manager = ConfigManager(
            storage=storage,
        )
        # Composed account manager: owns all account / admin-marker CRUD.
        self._account_manager = account_manager # To replace accountadminservice
        # Composed reload orchestrator: owns hot-reload coordination.
        self._reload_orchestrator = ReloadOrchestrator(
            storage=storage,
            azure_client=azure_client,
            account_manager=account_manager,
            reloadable_services=reloadable_services or [],
        )

    def get_config(self, key: str, default=None):
        """Load a key from the config namespace.  Delegates to ConfigManager."""
        return self._config_manager.get_config(key, default)

    def save_config(self, key: str, content) -> None:
        """Create a timestamped backup of *key* then persist *content*.  Delegates to ConfigManager."""
        self._config_manager.save_config(key, content)

    def save_config_raw(self, key: str, content) -> None:
        """Persist *content* under *key* without a backup.  Delegates to ConfigManager."""
        self._config_manager.save_config_raw(key, content)

    def get_project_map(self):
        """Return the project map from the project service."""
        return self._project_service.get_project_map() if self._project_service else []

    def _backup_config(self, key: str) -> None:
        """Delegate to ConfigManager.  Kept for backward compatibility."""
        self._config_manager._backup_config(key)

    def get_backup(self) -> dict:
        """Create a full backup snapshot.  Delegates to ConfigManager."""
        return self._config_manager.get_backup()

    # Backup snapshot management (individual entries)
    def list_backup_snapshots(self) -> list[dict]:
        """List all timestamped backup keys in the 'config' namespace."""
        return self._config_manager.list_backup_keys()

    def get_snapshot_content(self, key: str) -> Any:
        """Load the content of a single backup snapshot entry."""
        return self._config_manager.get_snapshot(key)

    def delete_snapshot_entry(self, key: str) -> None:
        """Delete a single backup snapshot entry."""
        self._config_manager.delete_snapshot(key)

    def prune_snapshots(self, keep_last: int = 5) -> dict:
        """Prune backups keeping the last *keep_last* entries per config key."""
        return self._config_manager.prune_backups(keep_last=keep_last)

    def restore_snapshot_entry(self, key: str) -> Any:
        """Restore a config value from a backup snapshot (no new backup created)."""
        return self._config_manager.restore_snapshot(key)

    def restore_backup(self, data, current_user_email=None) -> dict:
        """Restore config and data from a backup.  Delegates to ConfigManager."""
        return self._config_manager.restore_backup(
            data,
            current_admins=self._account_manager.get_all_with_permission(AccountPermissions.ADMIN),
            current_user_email=current_user_email,
            sync_accounts_fn=self._account_manager.sync_accounts_full,
        )

    def reload_config(self, session_id: str = '') -> dict:
        """Reload configuration artifacts touched by the admin UI.

        Delegates to the composed ReloadOrchestrator.
        """
        try:
            return self._reload_orchestrator.reload(session_id=session_id)
        except Exception as e:
            logger.exception('Failed to reload configuration: %s', e)
            raise

