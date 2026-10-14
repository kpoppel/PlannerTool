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
from planner_lib.admin.workforce_config import (
    DefinitionKind, WorkforceConfigManager, WorkforceConflictError, WorkforceSnapshot,
)
from planner_lib.admin.workforce_deletion import TeamDeletionReview
from planner_lib.domain.teams import TeamConfiguration
from planner_lib.domain.workforce import WorkforceConfiguration
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
        *, task_storage: StorageBackend | None = None,
    ) -> None:
        self._project_service = project_repository  # internal alias kept for brevity
        # Composed config manager: owns all config CRUD + backup/restore.
        self._config_manager = ConfigManager(
            storage=storage,
        )
        self._workforce_config = WorkforceConfigManager(storage, task_storage=task_storage)
        # Composed account manager: owns all account / admin-marker CRUD.
        self._account_manager = account_manager # To replace accountadminservice
        # Composed reload orchestrator: owns hot-reload coordination.
        self._reload_orchestrator = ReloadOrchestrator(
            storage=storage,
            azure_client=azure_client,
            reloadable_services=reloadable_services or [],
        )

    def get_config(self, key: str, default=None):
        """Load a key from the config namespace.  Delegates to ConfigManager."""
        return self._config_manager.get_config(key, default)

    def save_config(self, key: str, content) -> None:
        """Create a timestamped backup of *key* then persist *content*.  Delegates to ConfigManager."""
        self._guard_legacy_workforce_save(key)
        self._config_manager.save_config(key, content)

    def save_config_raw(self, key: str, content) -> None:
        """Persist *content* under *key* without a backup.  Delegates to ConfigManager."""
        self._guard_legacy_workforce_save(key)
        self._config_manager.save_config_raw(key, content)

    def _guard_legacy_workforce_save(self, key: str) -> None:
        if key in {'teams', 'workforce', 'people', 'cost_config'} and (
            self._workforce_config.has_canonical_teams()
        ):
            raise WorkforceConflictError('Use the canonical Workforce editing endpoint')

    def get_workforce_snapshot(self) -> WorkforceSnapshot:
        """Return the coherent canonical editing snapshot without legacy conversion."""
        return self._workforce_config.read_snapshot()

    def save_workforce_configuration(
        self, teams: TeamConfiguration, workforce: WorkforceConfiguration, revision: str,
    ) -> WorkforceSnapshot:
        """Delegate validated, revision-checked paired edits to the canonical owner."""
        return self._workforce_config.save_configuration(teams, workforce, revision)

    def create_workforce_definition(
        self, kind: DefinitionKind, fields: dict[str, Any], revision: str,
        *, supplier_id: str | None = None,
    ) -> WorkforceSnapshot:
        """Delegate identity issuance using editable fields only."""
        return self._workforce_config.create_definition(
            kind, fields, revision, supplier_id=supplier_id,
        )

    def review_workforce_team_deletion(
        self, team_id: str, *, task_storage: StorageBackend,
    ) -> TeamDeletionReview:
        """Review retained-reference impact without fetching or rewriting authoritative tasks."""
        return self._workforce_config.review_team_deletion(team_id, task_storage=task_storage)

    def delete_workforce_team(
        self, team_id: str, revision: str, *, acknowledged: bool,
        review_revision: str, task_storage: StorageBackend,
    ) -> WorkforceSnapshot:
        """Apply only a freshly reviewed, explicitly acknowledged destructive operation."""
        return self._workforce_config.delete_team(
            team_id, revision, acknowledged=acknowledged,
            review_revision=review_revision, task_storage=task_storage,
        )

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

    def reload_config(self) -> dict:
        """Reload configuration artifacts touched by the admin UI.

        Delegates to the composed ReloadOrchestrator.
        """
        try:
            return self._reload_orchestrator.reload()
        except Exception as e:
            logger.exception('Failed to reload configuration: %s', e)
            raise

