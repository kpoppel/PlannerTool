"""TDD tests for remaining P1/P2/P3 architectural review items:

1. Email validation in AccountManager — currently only checks '@' in string,
   which accepts 'no-domain@', '@nodomain', 'a@b', etc.
   Fix: validate local@domain.tld structure with a simple RFC-5321-lite regex.

2. PAT encryption at rest — PATs are stored as plaintext strings in YAML.
   Fix: Fernet symmetric encryption using PLANNER_SECRET_KEY env var.

3. Scenario/view store deduplication — both modules implement the same
   lock+register+CRUD pattern.
   Fix: extract a generic UserDataStore helper used by both.
"""
import pytest
import os


# ---------------------------------------------------------------------------
# 1. Email validation
# ---------------------------------------------------------------------------

class TestEmailValidation:
    def _make_storage(self):
        class FakeStorage:
            def __init__(self):
                self.data = {}
            def load(self, ns, key):
                if key in self.data:
                    return self.data[key]
                raise KeyError(key)
            def save(self, ns, key, value):
                self.data[key] = value
        return FakeStorage()

    def _make_manager(self, storage=None):
        from planner_lib.accounts.config import AccountManager
        return AccountManager(account_storage=storage or self._make_storage())

    # These must be accepted
    @pytest.mark.parametrize('email', [
        'user@example.com',
        'user.name+tag@sub.domain.org',
        'a@b.io',
    ])
    def test_valid_emails_accepted(self, email, monkeypatch):
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountPayload
        mgr = self._make_manager()
        result = mgr.save(AccountPayload(email=email, pat='tok'))
        assert result['ok'], f"Expected {email!r} to be accepted"

    # These must be rejected
    @pytest.mark.parametrize('email', [
        'notanemail',           # no @ at all
        '@nodomain',            # no local part
        'nodotat@',             # no domain
        'missing-tld@nodot',    # no dot in domain (single-label domain)
        'spaces in@email.com',  # spaces in local part
        '',                     # empty
    ])
    def test_invalid_emails_rejected(self, email, monkeypatch):
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountPayload
        mgr = self._make_manager()
        result = mgr.save(AccountPayload(email=email, pat='tok'))
        assert not result['ok'], f"Expected {email!r} to be rejected, got {result}"


# ---------------------------------------------------------------------------
# 2. PAT encryption at rest
# ---------------------------------------------------------------------------

class TestPatEncryption:
    """PATs must be stored encrypted and decrypted transparently by AccountManager."""

    def _make_storage(self):
        class FakeStorage:
            def __init__(self):
                self.data = {}
                self.raw_saved = {}  # mirrors data but preserves types

            def load(self, ns, key):
                if key in self.data:
                    return self.data[key]
                raise KeyError(key)

            def save(self, ns, key, value):
                self.raw_saved[key] = value
                self.data[key] = value
        return FakeStorage()

    def _make_manager(self, storage=None):
        from planner_lib.accounts.config import AccountManager
        return AccountManager(account_storage=storage or self._make_storage())

    def test_pat_not_stored_as_plaintext(self, monkeypatch):
        """PAT must not appear verbatim in saved storage payload."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountPayload
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        plain_pat = 'my-plaintext-azure-PAT-12345'
        mgr.save(AccountPayload(email='user@example.com', pat=plain_pat))

        saved = storage.raw_saved.get('user@example.com', {})
        stored_pat = saved.get('pat', '')
        assert stored_pat != plain_pat, (
            "PAT was stored verbatim in plaintext — it should be encrypted"
        )
        assert stored_pat  # Something was stored

    def test_pat_round_trip(self, monkeypatch):
        """Loading a saved account must return the original plaintext PAT."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountPayload
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        plain_pat = 'my-plaintext-azure-PAT-12345'
        mgr.save(AccountPayload(email='user@example.com', pat=plain_pat))
        loaded = mgr.load('user@example.com')
        assert loaded['pat'] == plain_pat, (
            f"Round-trip failed: expected {plain_pat!r}, got {loaded['pat']!r}"
        )

    def test_existing_account_pat_preserved_on_empty_update(self, monkeypatch):
        """Saving with pat='' must preserve the existing (encrypted) PAT."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountPayload
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        mgr.save(AccountPayload(email='user@example.com', pat='original-PAT'))
        mgr.save(AccountPayload(email='user@example.com', pat=''))  # empty = preserve
        loaded = mgr.load('user@example.com')
        assert loaded['pat'] == 'original-PAT'


# ---------------------------------------------------------------------------
# 3. Scenario/view store deduplication — generic UserDataStore
# ---------------------------------------------------------------------------

class TestUserDataStoreDeduplication:
    """scenario_store and view_store must delegate to a shared UserDataStore."""

    def test_scenario_store_uses_user_data_store(self):
        """scenario_store functions must exist and work via the generic store."""
        from planner_lib.scenarios.scenario_store import (
            save_user_scenario, load_user_scenario, delete_user_scenario,
            load_scenario_register,
        )
        # Basic smoke test: functions exist and are importable
        assert callable(save_user_scenario)
        assert callable(load_user_scenario)
        assert callable(delete_user_scenario)

    def test_view_store_uses_user_data_store(self):
        """view_store functions must exist and work via the generic store."""
        from planner_lib.views.view_store import (
            save_user_view, load_user_view, delete_user_view,
            load_view_register,
        )
        assert callable(save_user_view)
        assert callable(load_user_view)
        assert callable(delete_user_view)

    def test_user_data_store_generic_module_exists(self):
        """A shared UserDataStore class must exist in planner_lib.storage.user_store."""
        from planner_lib.storage.user_store import UserDataStore
        assert UserDataStore is not None

    def test_user_data_store_save_load_delete(self, tmp_path):
        """UserDataStore must support save, load, delete, and list_register."""
        from planner_lib.storage.user_store import UserDataStore
        from planner_lib.storage.base import StorageBackend

        class FakeStorage:
            def __init__(self):
                self.data = {}
            def load(self, ns, key):
                if key in self.data:
                    return self.data[key]
                raise KeyError(key)
            def save(self, ns, key, value):
                self.data[key] = value
            def delete(self, ns, key):
                if key in self.data:
                    del self.data[key]
                else:
                    raise KeyError(key)
            def list_keys(self, ns):
                return list(self.data.keys())

        storage = FakeStorage()
        store = UserDataStore(namespace='test_ns', register_key='test_register',
                              lock_file='test_register.lock', storage=storage)

        # save
        meta = store.save_item('user1', None, {'title': 'My Item'})
        assert 'id' in meta
        item_id = meta['id']

        # load
        data = store.load_item('user1', item_id)
        assert data['title'] == 'My Item'

        # register
        reg = store.load_register()
        assert any(v.get('id') == item_id for v in reg.values())

        # delete
        deleted = store.delete_item('user1', item_id)
        assert deleted
        with pytest.raises(KeyError):
            store.load_item('user1', item_id)


# ---------------------------------------------------------------------------
# 4. PAT corruption & format validation safety
# ---------------------------------------------------------------------------

class TestPatValidation:
    """AccountManager must reject malformed PATs on save and survive corrupt PATs on load."""

    def _make_storage(self):
        class FakeStorage:
            def __init__(self):
                self.data = {}
            def load(self, ns, key):
                if key in self.data:
                    return self.data[key]
                raise KeyError(key)
            def save(self, ns, key, value):
                self.data[key] = value
        return FakeStorage()

    def _make_manager(self, storage=None):
        from planner_lib.accounts.config import AccountManager
        return AccountManager(account_storage=storage or self._make_storage())

    @pytest.mark.parametrize('bad_pat', [
        'token with spaces',
        'token\twith\ttab',
        'token\nwith\nnewline',
        '\x00null',
        'a' * 513,  # too long
    ])
    def test_invalid_pat_formats_rejected_on_save(self, bad_pat, monkeypatch):
        """AccountManager.save must return ok=False for malformed PATs."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountPayload
        mgr = self._make_manager()
        result = mgr.save(AccountPayload(email='user@example.com', pat=bad_pat))
        assert result.get('ok') is False, f"Expected malformed PAT {bad_pat!r} to be rejected"
        assert result.get('error') == 'invalid_pat'

    def test_corrupted_stored_pat_returns_none_on_load(self, monkeypatch):
        """If the stored ciphertext is corrupt, load must return pat=None, not raise."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        storage = self._make_storage()
        # Manually inject a corrupt (non-Fernet) encrypted value into storage
        storage.data['user@example.com'] = {
            'email': 'user@example.com',
            'pat': 'this-is-not-a-valid-fernet-token',
        }
        mgr = self._make_manager(storage)
        loaded = mgr.load('user@example.com')
        assert loaded['ok'] is True
        # Should degrade gracefully: pat is None, not a crash
        assert loaded['pat'] is None

    def test_wrong_key_returns_none_on_load(self, monkeypatch, tmp_path):
        """A PAT encrypted with key A must degrade to None when loaded with key B."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'key-A-llllllllllllllllllllllllll')
        from planner_lib.accounts.config import AccountPayload
        storage = self._make_storage()
        mgr = self._make_manager(storage)
        mgr.save(AccountPayload(email='user@example.com', pat='validtoken123'))

        # Switch to a different key (simulates key rotation or misconfiguration)
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'key-B-llllllllllllllllllllllllll')
        # Must not raise; pat returns None so session creation continues safely
        loaded = mgr.load('user@example.com')
        assert loaded['ok'] is True
        assert loaded['pat'] is None
