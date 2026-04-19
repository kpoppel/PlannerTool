"""ConfigManager: CRUD + backup/restore for YAML configuration files.

Extracted from AdminService to honour the Single Responsibility Principle.
AdminService composes a ConfigManager instance and delegates all config-file
operations to it; callers that hold an AdminService reference are unaffected.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

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

    ``views_storage`` and ``scenarios_storage`` are optional; they allow the
    backup/restore paths to use a different backend from the main config
    storage (e.g. diskcache for runtime data vs file-backed YAML for config).
    """

    # Keys written during a full backup
    CONFIG_KEYS = [
        "projects", "teams", "people", "cost_config",
        "area_plan_map", "iterations", "server_config",
    ]

    def __init__(
        self,
        config_storage: StorageBackend,
        account_storage: StorageBackend,
        views_storage: Optional[StorageBackend] = None,
        scenarios_storage: Optional[StorageBackend] = None,
    ) -> None:
        self._config_storage = config_storage
        self._account_storage = account_storage
        self._views_storage = views_storage
        self._scenarios_storage = scenarios_storage

    # ------------------------------------------------------------------
    # Read / write
    # ------------------------------------------------------------------

    def get_config(self, key: str, default: Any = None) -> Any:
        """Load *key* from the config namespace.

        Returns *default* (``None``) when the key does not exist.
        Raw bytes values are decoded to UTF-8 strings.
        """
        try:
            data = self._config_storage.load('config', key)
            if isinstance(data, (bytes, bytearray)):
                return data.decode('utf-8')
            return data
        except KeyError:
            return default

    def save_config(self, key: str, content: Any) -> None:
        """Create a timestamped backup of *key* then persist *content*.

        If the key does not yet exist no backup is created.
        """
        self._backup_config(key)
        self._config_storage.save('config', key, content)

    def save_config_raw(self, key: str, content: Any) -> None:
        """Persist *content* under *key* without creating a backup.

        Use this for computed/dynamic config keys (e.g. area_plan_map after
        an automated refresh) where the data is always derived and the
        canonical version is the latest computed result.
        """
        self._config_storage.save('config', key, content)

    def _backup_config(self, key: str) -> None:
        """Create a timestamped backup of an existing config key.

        Silently no-ops when the key does not exist.
        """
        try:
            existing = self._config_storage.load('config', key)
        except KeyError:
            return
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup_key = f"{key}_backup_{ts}"
        try:
            self._config_storage.save('config', backup_key, existing)
        except Exception as e:
            backend = getattr(self._config_storage, '_backend', None)
            if backend is not None:
                try:
                    backend.save('config', backup_key, existing)
                except Exception:
                    logger.exception('Backend save also failed for backup %s', backup_key)
            else:
                logger.exception('Cannot backup config key %s: %s', backup_key, e)

    # ------------------------------------------------------------------
    # Backup / restore
    # ------------------------------------------------------------------

    def get_backup(self) -> dict:
        """Create a full backup snapshot of configuration and data.

        PATs are decrypted to plaintext before being written into the JSON
        so the backup can be restored to a fresh installation using a
        different ``PLANNER_SECRET_KEY``.  The ``_meta.pat_format`` field is
        set to ``"plaintext"`` so :meth:`restore_backup` knows to re-encrypt
        them on the way back in.
        """
        backup_data: dict = {
            "_meta": {"pat_format": "plaintext"},
            "config": {},
            "accounts": {},
            "views": {},
            "scenarios": {},
        }

        # Configuration files
        for key in self.CONFIG_KEYS:
            try:
                backup_data["config"][key] = self._config_storage.load('config', key)
            except KeyError:
                backup_data["config"][key] = None

        # User accounts and admin markers.
        # PATs are decrypted so the backup JSON is portable across key rotations.
        try:
            from planner_lib.accounts.config import _try_decrypt_pat
            users: dict = {}
            for user_key in self._account_storage.list_keys('accounts'):
                raw = self._account_storage.load('accounts', user_key)
                if isinstance(raw, dict) and raw.get('pat'):
                    # Decrypt to plaintext; falls back to None on corrupt/missing ciphertext.
                    raw = dict(raw)
                    raw['pat'] = _try_decrypt_pat(raw['pat'])
                users[user_key] = raw
            admins: dict = {}
            for admin_key in self._account_storage.list_keys('accounts_admin'):
                # Admin marker records typically just contain email; handle PAT defensively.
                raw = self._account_storage.load('accounts_admin', admin_key)
                if isinstance(raw, dict) and raw.get('pat'):
                    raw = dict(raw)
                    raw['pat'] = _try_decrypt_pat(raw['pat'])
                admins[admin_key] = raw
            backup_data["accounts"] = {"users": users, "admins": admins}
        except Exception as e:
            logger.error("Failed to backup accounts: %s", e)
            backup_data["accounts"] = {"users": {}, "admins": {}}

        # Views
        try:
            storage = self._views_storage or self._config_storage
            for key in list(storage.list_keys('views') or []):
                try:
                    backup_data["views"][key] = storage.load('views', key)
                except Exception as e:
                    logger.error("Failed to backup view %s: %s", key, e)
        except Exception as e:
            logger.error("Failed to list views for backup: %s", e)

        # Scenarios
        try:
            storage = self._scenarios_storage or self._config_storage
            for key in list(storage.list_keys('scenarios') or []):
                try:
                    backup_data["scenarios"][key] = storage.load('scenarios', key)
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
        """Restore configuration and data from a backup snapshot.

        Parameters
        ----------
        data:
            Backup dict as produced by :meth:`get_backup`.
        current_admins:
            List of current admin emails; used to guard against removing the
            currently authenticated admin.  Pass :meth:`AdminService.get_all_admins`
            result here.
        current_user_email:
            Email of the currently authenticated user.
        sync_accounts_fn:
            Callable ``(users, admins)`` that persists the account changes.
            Pass :meth:`AdminService.sync_accounts_full`.
        """
        if "config" in data:
            for key, content in data["config"].items():
                if content is not None:
                    self._config_storage.save('config', key, content)

        if "accounts" in data:
            users = data["accounts"].get("users", {})
            admins = data["accounts"].get("admins", {})
            # Guard: don't let a restore remove the currently authenticated admin.
            if (
                current_user_email
                and current_admins
                and current_user_email in current_admins
                and current_user_email not in admins
            ):
                raise ValueError("Cannot remove the current admin account.")

            # Re-encrypt PATs when the backup was produced with plaintext PATs
            # (i.e. by get_backup() after the pat_format="plaintext" change).
            # Old encrypted backups (no _meta or pat_format != "plaintext") are
            # passed through unchanged for backward compatibility.
            pat_format = (data.get("_meta") or {}).get("pat_format")
            if pat_format == "plaintext":
                try:
                    from planner_lib.accounts.config import _encrypt_pat
                    def _reencrypt(record: dict) -> dict:
                        if not isinstance(record, dict):
                            return record
                        rec = dict(record)
                        if rec.get('pat'):
                            try:
                                rec['pat'] = _encrypt_pat(rec['pat'])
                            except Exception:
                                # If encryption fails (e.g. key not set), store without PAT
                                # rather than crash; admin can re-enter it via the UI.
                                logger.warning(
                                    'Could not re-encrypt PAT for %s during restore; '
                                    'PAT will be cleared.',
                                    rec.get('email', '?'),
                                )
                                rec['pat'] = None
                        return rec
                    users = {k: _reencrypt(v) for k, v in users.items()}
                    admins = {k: _reencrypt(v) for k, v in admins.items()}
                except Exception as e:
                    logger.error('PAT re-encryption during restore failed: %s', e)

            if sync_accounts_fn is not None:
                sync_accounts_fn(users, admins)

        if "views" in data:
            storage = self._views_storage or self._config_storage
            for key, content in data["views"].items():
                storage.save('views', key, content)

        if "scenarios" in data:
            storage = self._scenarios_storage or self._config_storage
            for key, content in data["scenarios"].items():
                storage.save('scenarios', key, content)

        return {"ok": True, "message": "Restore completed successfully."}
