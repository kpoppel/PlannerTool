"""Canonical admin configuration owner selected with the workforce runtime."""
from typing import Any

from planner_lib.admin.service import AdminService
from planner_lib.domain.allocation_availability import validate_project_availability
from planner_lib.domain.teams import TeamCatalogue


class WorkforceAdminService(AdminService):
    """Serialize project availability checks with catalogue mutation and persistence."""

    def save_config(self, key: str, content: Any) -> None:
        """Validate project references before writing either a backup or the new value."""
        if key != 'projects':
            super().save_config(key, content)
            return
        with self._config_manager._storage.transaction():
            catalogue = TeamCatalogue(self.get_config('teams'))
            validate_project_availability(content, catalogue.definitions())
            super().save_config(key, content)

    def save_config_raw(self, key: str, content: Any) -> None:
        """Apply the same reference contract to direct project writes."""
        if key != 'projects':
            super().save_config_raw(key, content)
            return
        with self._config_manager._storage.transaction():
            catalogue = TeamCatalogue(self.get_config('teams'))
            validate_project_availability(content, catalogue.definitions())
            super().save_config_raw(key, content)

    def restore_snapshot_entry(self, key: str) -> Any:
        """Restore only through the validated writer, never bypassing lifecycle ownership."""
        canonical_key, separator, stamp = key.partition('_backup_')
        if not separator or not stamp:
            raise ValueError(f'Invalid backup key format: {key}')
        self._guard_legacy_workforce_save(canonical_key)
        with self._config_manager._storage.transaction():
            content = self.get_snapshot_content(key)
            self.save_config_raw(canonical_key, content)
            return content

    def restore_backup(
        self, data: dict[str, Any], current_user_email: str | None = None,
    ) -> dict[str, Any]:
        """Restore compatible user data without bypassing workforce identity and lifecycle checks."""
        with self._config_manager._storage.transaction():
            self._config_manager._validate_compatibility(data)
            config = data.get('config', {})
            canonical_keys = {'teams', 'workforce'} & config.keys()
            if canonical_keys and canonical_keys != {'teams', 'workforce'}:
                raise ValueError('Logical workforce restore requires both teams and workforce')
            if canonical_keys:
                teams = config['teams']
                workforce = config['workforce']
                if teams is None or workforce is None:
                    raise ValueError('Logical workforce restore requires complete canonical configurations')
                catalogue = self._workforce_config.validate_configuration(teams, workforce)
            else:
                catalogue = TeamCatalogue(self.get_config('teams'))
            if config.get('projects') is not None:
                validate_project_availability(config['projects'], catalogue.definitions())
            return super().restore_backup(data, current_user_email)