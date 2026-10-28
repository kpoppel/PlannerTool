"""ConfigManager: CRUD + backup/restore for configuration data.

Extracted from AdminService to honour the Single Responsibility Principle.
AdminService composes a ConfigManager instance and delegates all config
operations to it; callers that hold an AdminService reference are unaffected.

Storage routing
---------------
All config keys (including server_config) are stored in the diskcache-backed
``_config_storage``.
"""
from __future__ import annotations

import logging
import math
import re
from contextlib import nullcontext
from typing import Any, Optional
from uuid import UUID

from planner_lib.storage.base import StorageBackend

logger = logging.getLogger(__name__)


class ConfigManager:
    """Manages configuration files stored in the 'config' storage namespace.

    Responsibilities:
    - Load a single config key (with bytes→str coercion)
    - Save config with automatic timestamped backup of the previous value
    - Save config *without* backup (for derived/computed keys)
    - Get a full backup snapshot of all known config keys
    - Restore config and data from a backup snapshot
    """

    # Keys written during a full backup.
    CONFIG_KEYS = [
        'authentication',
        "projects", "teams", "workforce",
        "area_plan_map", "iterations", "global_settings", "ado_config", "ado_processes", "plugin_runtime_config", "server_config",
    ]

    def __init__(
        self,
        storage: StorageBackend,
    ) -> None:
        self._storage = storage

    # ------------------------------------------------------------------
    # Read / write
    # ------------------------------------------------------------------

    def get_config(self, key: str, default: Any = None) -> Any:
        """Load *key* from the config namespace.

        Returns *default* (``None``) when the key does not exist.
        Raw bytes values (from legacy file storage) are decoded to UTF-8 strings.
        """
        try:
            data = self._storage.load('config', key)
            if isinstance(data, (bytes, bytearray)):
                return data.decode('utf-8')
            return data
        except KeyError:
            return default

    def save_config(self, key: str, content: Any) -> None:
        """Create a timestamped backup of *key* then persist *content*.

        If the key does not yet exist no backup is created.  The backup step
        is gated by the ``manage_backup_snapshots`` feature flag — when False
        (default), only the canonical value is persisted and no ghost entries
        accumulate in diskcache.
        """
        if key == 'authentication':
            self._validate_auth_policy_change(content)
        self._validate_backend_config(key, content)
        if self._should_backup():
            self._backup_config(key)

        # Preserve existing feature_flags when saving server_config so that
        # enabling manage_backup_snapshots persists across saves.
        if key == 'server_config' and isinstance(content, dict):
            try:
                existing = self._storage.load('config', 'server_config') or {}
                existing_flags = existing.get('feature_flags', {})
                if existing_flags and not content.get('feature_flags'):
                    content = {**content, 'feature_flags': existing_flags}
            except Exception:
                pass

        self._storage.save('config', key, content)

    def _should_backup(self) -> bool:
        """Return True when backup snapshots are enabled."""
        try:
            flags = self._storage.load('config', 'server_config') or {}
            return bool(flags.get('feature_flags', {}).get('manage_backup_snapshots'))
        except Exception:
            # server_config not yet written — no backups needed
            return False

    def save_config_raw(self, key: str, content: Any) -> None:
        """Persist *content* under *key* without creating a backup.

        Use this for computed/dynamic config keys (e.g. area_plan_map after
        an automated refresh) where the data is always derived and the
        canonical version is the latest computed result.
        """
        if key == 'authentication':
            self._validate_auth_policy_change(content)
        self._validate_backend_config(key, content)
        self._storage.save('config', key, content)

    def _validate_backend_config(self, key, content, *, overrides=None):
        from planner_lib.session.policy import validate_backend_policy
        validate_backend_policy(self._storage, key, content, overrides=overrides)

    def _validate_auth_policy_change(self, content):
        from planner_lib.session.policy import validate_authentication

        validate_authentication(content)
        current = self._storage.load('config', 'authentication')
        if content != current:
            raise ValueError('Authentication policy is deployment-controlled; no save/import override')

    def _backup_config(self, key: str) -> None:
        """Create a timestamped backup of an existing config key.

        Silently no-ops when the key does not exist.
        """
        try:
            existing = self._storage.load('config', key)
        except KeyError:
            return
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup_key = f"{key}_backup_{ts}"
        try:
            self._storage.save('config', backup_key, existing)
        except Exception as e:
            backend = getattr(self._storage, '_backend', None)
            if backend is not None:
                try:
                    backend.save('config', backup_key, existing)
                except Exception:
                    logger.exception('Backend save also failed for backup %s', backup_key)
            else:
                logger.exception('Cannot backup config key %s: %s', backup_key, e)

    # ------------------------------------------------------------------
    # Backup snapshot management (individual entries)
    # ------------------------------------------------------------------

    def list_backup_keys(self) -> list[dict]:
        """List all timestamped backup keys in the 'config' namespace.

        Returns a sorted list of dicts:
            [{'key': str, 'timestamp_str': str, 'config_key': str}, ...]
        where *config_key* is the canonical key (e.g. "projects") and
        *timestamp_str* is the ISO-like suffix from the backup key name.
        """
        prefix = "config::"
        backups: list[dict] = []
        for raw_key in self._storage.list_keys('config'):
            if isinstance(raw_key, bytes):
                raw_key = raw_key.decode('utf-8')
            # Match keys like "projects_backup_20260727T143022Z"
            if '_backup_' not in raw_key:
                continue
            parts = raw_key.split('_backup_', 1)
            config_key = parts[0]
            ts_str = parts[1]
            backups.append({
                'key': f"{config_key}_backup_{ts_str}",
                'timestamp_str': ts_str,
                'config_key': config_key,
            })
        # Sort by config_key then timestamp descending (newest first)
        backups.sort(key=lambda b: (b['config_key'], b['timestamp_str']), reverse=True)
        return backups

    def get_snapshot(self, key: str) -> Any:
        """Load the content of a single backup snapshot entry.

        Raises ``KeyError`` if the key does not exist.
        """
        return self._storage.load('config', key)

    def delete_snapshot(self, key: str) -> None:
        """Delete a single backup snapshot entry."""
        self._storage.delete('config', key)

    def prune_backups(self, keep_last: int = 5) -> dict:
        """Prune backup snapshots, keeping the last *keep_last* entries per config key.

        Returns ``{'deleted_count': int, 'kept_count': int}``.
        """
        backups_by_key: dict[str, list[dict]] = {}
        for bk in self.list_backup_keys():
            backups_by_key.setdefault(bk['config_key'], []).append(bk)

        deleted_count = 0
        kept_count = 0
        for config_key, entries in backups_by_key.items():
            # entries are sorted newest-first from list_backup_keys
            if len(entries) <= keep_last:
                kept_count += len(entries)
                continue
            to_delete = entries[keep_last:]
            for entry in to_delete:
                try:
                    self._storage.delete('config', entry['key'])
                    deleted_count += 1
                except Exception:
                    logger.exception('Failed to delete backup snapshot %s', entry['key'])
            kept_count += keep_last

        return {'deleted_count': deleted_count, 'kept_count': kept_count}

    def restore_snapshot(self, key: str) -> Any:
        """Restore a config value from a backup snapshot.

        Copies the snapshot content to the canonical config key (without creating another backup).
        Returns the restored content.
        """
        content = self.get_snapshot(key)
        # Extract the original config key from the backup key name
        parts = key.split('_backup_', 1)
        if len(parts) != 2:
            raise ValueError(f"Invalid backup key format: {key}")
        canonical_key = parts[0]
        if canonical_key == 'authentication':
            self._validate_auth_policy_change(content)
        self._validate_backend_config(canonical_key, content)
        self._storage.save('config', canonical_key, content)
        return content

    # ------------------------------------------------------------------
    # Backup / restore
    # ------------------------------------------------------------------

    def _transaction(self):
        cache = getattr(self._storage, '_cache', None)
        return cache.transact() if cache is not None else nullcontext()

    def get_backup(self) -> dict:
        with self._transaction():
            return self._get_backup()

    def _get_backup(self) -> dict:
        """Create a logical data backup without authentication authority."""
        backup_data: dict = {
            "schema_revision": self._storage.load('system', 'schema_state')['schema_revision'],
            "config": {},
            "accounts": {},
            "views": {},
            "scenarios": {},
        }

        # Configuration files (all keys go to storage under 'config' namespace)
        for key in self.CONFIG_KEYS:
            if key == 'authentication':
                continue
            try:
                backup_data["config"][key] = self._storage.load('config', key)
            except KeyError:
                backup_data["config"][key] = None

        try:
            users: dict = {}
            for user_key in self._storage.list_keys('accounts'):
                raw = self._storage.load('accounts', user_key)
                users[user_key] = {key: value for key, value in raw.items()
                                   if key not in ('pat', 'pat_invalid')}
                users[user_key]['pat'] = None
            backup_data["accounts"] = {"users": users}
        except Exception as e:
            logger.error("Failed to backup accounts: %s", e)
            backup_data["accounts"] = {"users": {}}

        account_auth = {}
        for account in backup_data['accounts']['users'].values():
            account_id = account['account_id']
            account_auth[account_id] = {'enrolled': False}
        backup_data['authentication'] = {
            'account_auth': account_auth,
            'auth_control': {'bootstrap_claimed': True} if account_auth else {},
        }

        # Views
        try:
            for key in list(self._storage.list_keys('views') or []):
                try:
                    backup_data["views"][key] = self._storage.load('views', key)
                except Exception as e:
                    logger.error("Failed to backup view %s: %s", key, e)
        except Exception as e:
            logger.error("Failed to list views for backup: %s", e)

        # Scenarios
        try:
            for key in list(self._storage.list_keys('scenarios') or []):
                try:
                    backup_data["scenarios"][key] = self._storage.load('scenarios', key)
                except Exception as e:
                    logger.error("Failed to backup scenario %s: %s", key, e)
        except Exception as e:
            logger.error("Failed to list scenarios for backup: %s", e)

        return backup_data

    def restore_backup(
        self,
        data: dict,
        *,
        current_admins: Optional[list] = None,
        current_user_email: Optional[str] = None,
        sync_accounts_fn=None,
    ) -> dict:
        """Restore accounts and auth state atomically on diskcache storage."""
        self._validate_compatibility(data)
        with self._transaction():
            return self._restore_backup(
                data, current_admins=current_admins, current_user_email=current_user_email,
                sync_accounts_fn=sync_accounts_fn,
            )

    def _validate_compatibility(self, data):
        from planner_lib.migrations.contracts import TARGET_REVISION
        from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config

        if not isinstance(data, dict) or set(data) - {
            'schema_revision', 'config', 'accounts', 'authentication', 'views', 'scenarios', '_meta'
        }:
            raise ValueError('Logical backups cannot restore recovery metadata or unknown sections')
        if '_meta' in data and data['_meta'] != {'authentication': 'excluded'}:
            raise ValueError('Unsupported logical backup metadata')
        self._validate_user_data_ownership(data)
        if 'schema_revision' not in data:
            raise ValueError(f'Backup schema revision is required; this server requires schema revision {TARGET_REVISION}')
        if type(data['schema_revision']) is not int or data['schema_revision'] != TARGET_REVISION:
            raise ValueError(
                f'Incompatible backup schema; this server requires schema revision {TARGET_REVISION}. '
                'Use a matching server and independent full backup'
            )
        config = data.get('config', {})
        if not isinstance(config, dict) or set(config) - set(self.CONFIG_KEYS):
            raise ValueError('Logical backup contains unsupported configuration keys')
        if 'authentication' in config:
            raise ValueError('Authentication policy is deployment-controlled; no logical import')
        if 'accounts' in data:
            if (self._storage.exists('config', 'authentication')
                    and self._storage.load('config', 'authentication')['active'] == 'entra'):
                raise ValueError('Entra account replacement requires independent operator recovery')
            self._validate_authentication(data)
            if any(record.get('pat') for record in data['accounts']['users'].values()):
                raise ValueError('Logical restore cannot import PAT authority; supply fresh credentials')
            if any(record != {'enrolled': False}
                   for record in data['authentication']['account_auth'].values()):
                raise ValueError('Logical restore cannot import enrollment authority; enroll afresh')
        for key, value in config.items():
            if value is not None:
                self._validate_backend_config(key, value)
        self._validate_backend_config(None, None,
            overrides={key: value for key, value in config.items() if value is not None})
        projects = config.get('projects')
        if projects is not None and (
            not isinstance(projects, dict) or 'container_types' not in projects
        ):
            raise ValueError('Projects backup requires the current container hierarchy')
        plugins = config.get('plugin_runtime_config')
        if plugins is not None and normalize_plugin_runtime_config(plugins) != plugins:
            raise ValueError('Plugin backup requires the current canonical schema')
        server = config.get('server_config')
        if server is not None and 'enable_azure_cache' in server.get('feature_flags', {}):
            raise ValueError('Server backup contains unsupported legacy flags')
        for namespace in ('views', 'scenarios'):
            records = data.get(namespace, {})
            if not isinstance(records, dict):
                raise ValueError('User-data backup must be an object')
            register_key = 'view_register' if namespace == 'views' else 'scenario_register'
            for key, payload in records.items():
                if not isinstance(payload, dict):
                    raise ValueError('User-data backup contains invalid records')
                if key == register_key:
                    continue
                if namespace == 'views' and any(field in payload.get('viewOptions', {}) for field in (
                    'expandRelations', 'expandTeamAllocated', 'expandParentChild'
                )):
                    raise ValueError('Saved-view backup requires current Context fields')
                if namespace == 'views':
                    options = payload.get('viewOptions', {})
                    if type(options.get('packedModeUnplannedPreference')) is not bool:
                        raise ValueError('Saved-view backup requires a boolean packed-mode preference')
                    if (options.get('displayMode') == 'packed'
                            and options.get('taskFilters', {}).get('schedule', {}).get('unplanned') is not False):
                        raise ValueError('Packed saved-view backup must exclude Unplanned tasks')
                if namespace == 'scenarios' and any(
                    not isinstance(payload.get(field), list if field == 'scenarioGroups' else dict)
                    for field in ('overrides', 'filters', 'view', 'groupOverrides', 'scenarioGroups')
                ):
                    raise ValueError('Scenario backup requires current metadata')

    def _validate_authentication(self, data: dict) -> None:
        authentication = data.get('authentication')
        if not isinstance(authentication, dict) or set(authentication) != {'account_auth', 'auth_control'}:
            raise ValueError('Account restore requires a complete authentication section')
        accounts = data['accounts']
        if not isinstance(accounts, dict):
            raise ValueError('Invalid authentication account mapping')
        users = accounts.get('users')
        records = authentication['account_auth']
        control = authentication['auth_control']
        if not isinstance(users, dict) or not isinstance(records, dict) or not isinstance(control, dict):
            raise ValueError('Invalid authentication backup mappings')
        account_ids = set()
        for account in users.values():
            if not isinstance(account, dict):
                raise ValueError('Invalid authentication account record')
            account_id = account.get('account_id')
            try:
                canonical_id = str(UUID(account_id))
            except (AttributeError, TypeError, ValueError) as error:
                raise ValueError('Authentication account IDs must be canonical UUIDs') from error
            if canonical_id != account_id or account_id in account_ids:
                raise ValueError('Authentication account IDs must be unique canonical UUIDs')
            account_ids.add(account_id)
        if set(records) != account_ids:
            raise ValueError('Authentication records must match the restored account IDs')
        if control and (set(control) != {'bootstrap_claimed'} or control['bootstrap_claimed'] is not True):
            raise ValueError('Invalid authentication bootstrap marker')
        for record in records.values():
            if not isinstance(record, dict) or type(record.get('enrolled')) is not bool:
                raise ValueError('Invalid authentication enrollment state')
            if not record['enrolled']:
                if set(record) != {'enrolled'}:
                    raise ValueError('Unenrolled authentication records cannot contain credentials')
                continue
            if control != {'bootstrap_claimed': True}:
                raise ValueError('Enrolled authentication records require a bootstrap marker')
            if set(record) != {'enrolled', 'name', 'account_key_hash', 'devices'}:
                raise ValueError('Account backup requires the current account-key schema; create a new backup')
            if not isinstance(record.get('name'), str) or not record['name'].strip():
                raise ValueError('Enrolled authentication records require a display name')
            if not isinstance(record.get('account_key_hash'), str) or not re.fullmatch(r'[0-9a-f]{64}', record['account_key_hash']):
                raise ValueError('Invalid authentication account key hash')
            if not isinstance(record.get('devices'), dict):
                raise ValueError('Invalid authentication devices')
            for device_id, device in record['devices'].items():
                if not isinstance(device_id, str) or not re.fullmatch(r'[0-9a-f]{32}', device_id):
                    raise ValueError('Invalid authentication device ID')
                if not isinstance(device, dict) or not isinstance(device.get('hash'), str) or not re.fullmatch(r'[0-9a-f]{64}', device['hash']):
                    raise ValueError('Invalid authentication device hash')
                expires = device.get('expires')
                if type(expires) not in (int, float) or not math.isfinite(expires) or expires < 0:
                    raise ValueError('Invalid authentication device expiry')

    def _validate_user_data_ownership(self, data: dict) -> None:
        for namespace, register_key in (
            ('views', 'view_register'), ('scenarios', 'scenario_register'),
        ):
            if namespace not in data:
                continue
            records = data[namespace]
            if not isinstance(records, dict):
                raise ValueError('User-data backup must be an account ID mapping')
            for key, payload in records.items():
                if key == register_key:
                    if not isinstance(payload, dict):
                        raise ValueError('User-data register must be an account ID mapping')
                    for item_key, metadata in payload.items():
                        owner, _, item_id = item_key.partition('_')
                        if metadata['user'] != owner or metadata['id'] != item_id:
                            raise ValueError('User-data register must match its account ID keys')
                    owner_keys = payload
                else:
                    owner_keys = (key,)
                for item_key in owner_keys:
                    owner, separator, item_id = item_key.partition('_')
                    try:
                        canonical_id = str(UUID(owner))
                    except (AttributeError, TypeError, ValueError) as error:
                        raise ValueError('User-data owner must be an account ID; run migration 0032') from error
                    if canonical_id != owner or not separator or not item_id:
                        raise ValueError('User-data key must contain a canonical account ID')

    def _restore_backup(
        self,
        data: dict,
        *,
        current_admins: Optional[list] = None,
        current_user_email: Optional[str] = None,
        sync_accounts_fn=None,
    ) -> dict:
        """Restore configuration and data from a backup snapshot.

        Parameters
        ----------
        data:
            Backup dict as produced by :meth:`get_backup`.
        current_admins:
            List of current admin emails; used to guard against removing the
            currently authenticated admin.  Pass :meth:`AccountManager.get_all_with_permission`
            result here.
        current_user_email:
            Email of the currently authenticated user.
        sync_accounts_fn:
            Callable ``(users, admins)`` that persists the account changes.
            Pass :meth:`AdminService.sync_accounts_full`.
        """
        if 'accounts' in data:
            self._validate_authentication(data)
            if sync_accounts_fn is None:
                raise ValueError('Account restore requires an account sync function')
        elif 'authentication' in data:
            raise ValueError('Authentication restore requires accounts')

        self._validate_user_data_ownership(data)

        if "config" in data:
            for key, content in data["config"].items():
                if content is not None:
                    self._storage.save('config', key, content)

        if "accounts" in data:
            users = {email: dict(record) for email, record in data['accounts']['users'].items()}

            # Guard: don't let a restore remove the currently authenticated admin.
            if (
                current_user_email
                and current_admins
                and current_user_email in current_admins
                and current_user_email not in users
            ):
                raise ValueError("Cannot remove the current admin account.")

            if sync_accounts_fn is not None:
                # Derive admin set from permissions field in each user record.
                from planner_lib.accounts.constants import AccountPermissions
                admins_set = [k for k, v in users.items() if isinstance(v, dict) and AccountPermissions.ADMIN in (v.get('permissions') or [])]
                sync_accounts_fn(users, admins_set)

            for namespace in ('account_auth', 'auth_control'):
                for key in list(self._storage.list_keys(namespace)):
                    self._storage.delete(namespace, key)
                for key, content in data['authentication'][namespace].items():
                    if namespace == 'auth_control':
                        self._storage.save(namespace, key, content)
            import hashlib
            import secrets
            for email, account in users.items():
                self._storage.save('account_auth', account['account_id'], {
                    'enrolled': True, 'name': email, 'devices': {},
                    'account_key_hash': hashlib.sha256(secrets.token_urlsafe(32).encode()).hexdigest(),
                })

        if "views" in data:
            for key, content in data["views"].items():
                self._storage.save('views', key, content)

        if "scenarios" in data:
            for key, content in data["scenarios"].items():
                self._storage.save('scenarios', key, content)

        if 'accounts' in data:
            for key in list(self._storage.list_keys('external_identities')):
                self._storage.delete('external_identities', key)
        for namespace in ('auth_sessions', 'auth_transactions', 'auth_grants', 'auth_link_approvals',
                  'auth_transition_proofs'):
            for key in list(self._storage.list_keys(namespace)):
                if self._storage.exists(namespace, key):
                    self._storage.delete(namespace, key)

        result = {"ok": True, "message": "Restore completed successfully."}
        if 'accounts' in data:
            result['warning'] = (
                'Accounts and permissions restored without credentials. Active sessions have ended. '
                'Use the explicit operator enrollment recovery procedure and fresh user credentials. '
                'No old PAT, account key, browser binding or broker grant was imported.'
            )
        return result
