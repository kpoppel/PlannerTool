"""Account validation, credential confidentiality, identity and restore contracts."""
import pytest
from planner_lib.storage.memory_backend import MemoryStorage


# ---------------------------------------------------------------------------
# 1. Email validation
# ---------------------------------------------------------------------------

class TestEmailValidation:
    def _make_storage(self):
        return MemoryStorage()

    def _make_manager(self, storage=None):
        from planner_lib.accounts.config import AccountManager
        return AccountManager(storage=storage or self._make_storage())

    # These must be accepted
    @pytest.mark.parametrize('email', [
        'user@example.com',
        'user.name+tag@sub.domain.org',
        'a@b.io',
    ])
    def test_valid_emails_accepted(self, email, monkeypatch):
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountCredentialsPayload
        mgr = self._make_manager()
        result = mgr.update_credentials(AccountCredentialsPayload(email=email, pat='tok'))
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
        from planner_lib.accounts.config import AccountCredentialsPayload
        mgr = self._make_manager()
        result = mgr.update_credentials(AccountCredentialsPayload(email=email, pat='tok'))
        assert not result['ok'], f"Expected {email!r} to be rejected, got {result}"


# ---------------------------------------------------------------------------
# 2. PAT encryption at rest
# ---------------------------------------------------------------------------

class TestPatEncryption:
    """PATs must be stored encrypted and decrypted transparently by AccountManager."""

    def _make_storage(self):
        return MemoryStorage()

    def _make_manager(self, storage=None):
        from planner_lib.accounts.config import AccountManager
        return AccountManager(storage=storage or self._make_storage())

    def test_pat_not_stored_as_plaintext(self, monkeypatch):
        """PAT must not appear verbatim in saved storage payload."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountCredentialsPayload
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        plain_pat = 'my-plaintext-azure-PAT-12345'
        mgr.update_credentials(AccountCredentialsPayload(email='user@example.com', pat=plain_pat))

        saved = storage.load('accounts', 'user@example.com')
        stored_pat = saved.get('pat', '')
        assert stored_pat != plain_pat, (
            "PAT was stored verbatim in plaintext — it should be encrypted"
        )
        assert stored_pat  # Something was stored

    def test_pat_round_trip(self, monkeypatch):
        """Loading a saved account must return the original plaintext PAT."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountCredentialsPayload
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        plain_pat = 'my-plaintext-azure-PAT-12345'
        mgr.update_credentials(AccountCredentialsPayload(email='user@example.com', pat=plain_pat))
        loaded = mgr.load('user@example.com')
        assert loaded['pat'] == plain_pat, (
            f"Round-trip failed: expected {plain_pat!r}, got {loaded['pat']!r}"
        )

    def test_existing_account_pat_preserved_on_empty_update(self, monkeypatch):
        """Saving with pat='' must preserve the existing (encrypted) PAT."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountCredentialsPayload
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        mgr.update_credentials(AccountCredentialsPayload(email='user@example.com', pat='original-PAT'))
        mgr.update_credentials(AccountCredentialsPayload(email='user@example.com', pat=''))
        loaded = mgr.load('user@example.com')
        assert loaded['pat'] == 'original-PAT'

    def test_credential_update_preserves_existing_permissions(self, monkeypatch):
        """Omitting permissions during a credential update must not revoke admin access."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        from planner_lib.accounts.config import AccountCredentialsPayload
        from planner_lib.accounts.constants import AccountPermissions
        storage = self._make_storage()
        storage.save('accounts', 'admin@example.com', {
            'account_id': 'f34d9c3f-17bc-41e9-9233-1ec95d97c8bd',
            'email': 'admin@example.com',
            'pat': None,
            'permissions': [AccountPermissions.ADMIN],
        })
        mgr = self._make_manager(storage)

        mgr.update_credentials(
            AccountCredentialsPayload(email='admin@example.com', pat='replacement-PAT')
        )

        assert mgr.list_accounts()[0]['permissions'] == [AccountPermissions.ADMIN]

    def test_credential_payload_rejects_permissions(self):
        """The public credential contract must not accept authorization fields."""
        from pydantic import ValidationError
        from planner_lib.accounts.config import AccountCredentialsPayload

        with pytest.raises(ValidationError):
            AccountCredentialsPayload(
                email='admin@example.com',
                pat='replacement-PAT',
                permissions=['admin'],
            )

    def test_account_id_is_assigned_and_preserved_on_credential_update(self, monkeypatch):
        from uuid import UUID
        from planner_lib.accounts.config import AccountCredentialsPayload
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        result = mgr.create_account(
            AccountCredentialsPayload(email='user@example.com', pat='first-PAT')
        )
        account_id = result['id']
        UUID(account_id)

        mgr.update_credentials(
            AccountCredentialsPayload(email='user@example.com', pat='second-PAT')
        )

        assert mgr.get_account_id('user@example.com') == account_id
        assert mgr.get_account_by_id(account_id)['email'] == 'user@example.com'

    def test_list_accounts_exposes_ids_without_credentials(self, monkeypatch):
        from planner_lib.accounts.config import AccountCredentialsPayload
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        storage = self._make_storage()
        mgr = self._make_manager(storage)
        result = mgr.create_account(
            AccountCredentialsPayload(email='admin@example.com', pat='secret-PAT'),
            ['admin'],
        )

        assert mgr.list_accounts() == [{
            'id': result['id'],
            'email': 'admin@example.com',
            'permissions': ['admin'],
        }]

    def test_restore_preserves_account_ids(self):
        storage = self._make_storage()
        mgr = self._make_manager(storage)
        account_id = '11111111-1111-4111-8111-111111111111'

        mgr.sync_accounts_full({
            'user@example.com': {
                'account_id': account_id,
                'email': 'user@example.com',
                'permissions': [],
            },
        }, [])

        assert mgr.get_account_by_id(account_id)['email'] == 'user@example.com'

    @pytest.mark.parametrize('users', [
        {'user@example.com': {'email': 'user@example.com', 'permissions': []}},
        {
            'first@example.com': {
                'account_id': '11111111-1111-4111-8111-111111111111',
                'email': 'first@example.com',
                'permissions': [],
            },
            'second@example.com': {
                'account_id': '11111111-1111-4111-8111-111111111111',
                'email': 'second@example.com',
                'permissions': [],
            },
        },
    ])
    def test_restore_rejects_missing_or_duplicate_account_ids(self, users):
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        with pytest.raises(ValueError, match='Account ID'):
            mgr.sync_accounts_full(users, [])

        assert mgr.list_accounts() == []

    def test_get_account_by_id_rejects_non_uuid(self, monkeypatch):
        from planner_lib.accounts.config import AccountCredentialsPayload
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        storage = self._make_storage()
        mgr = self._make_manager(storage)
        mgr.create_account(AccountCredentialsPayload(email='user@example.com'))
        storage.list_keys = lambda ns: (_ for _ in ()).throw(AssertionError('storage scanned'))

        with pytest.raises(KeyError):
            mgr.get_account_by_id('user@example.com')


# ---------------------------------------------------------------------------
# 4. PAT corruption & format validation safety
# ---------------------------------------------------------------------------

class TestPatValidation:
    """AccountManager must reject malformed PATs on save and survive corrupt PATs on load."""

    def _make_storage(self):
        return MemoryStorage()

    def _make_manager(self, storage=None):
        from planner_lib.accounts.config import AccountManager
        return AccountManager(storage=storage or self._make_storage())

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
        from planner_lib.accounts.config import AccountCredentialsPayload
        mgr = self._make_manager()
        result = mgr.update_credentials(
            AccountCredentialsPayload(email='user@example.com', pat=bad_pat)
        )
        assert result.get('ok') is False, f"Expected malformed PAT {bad_pat!r} to be rejected"
        assert result.get('error') == 'invalid_pat'

    def test_corrupted_stored_pat_returns_none_on_load(self, monkeypatch):
        """If the stored ciphertext is corrupt, load must return pat=None, not raise."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        storage = self._make_storage()
        # Manually inject a corrupt (non-Fernet) encrypted value into storage
        storage.save('accounts', 'user@example.com', {
            'email': 'user@example.com',
            'pat': 'this-is-not-a-valid-fernet-token',
        })
        mgr = self._make_manager(storage)
        loaded = mgr.load('user@example.com')
        assert loaded['ok'] is True
        # Should degrade gracefully: pat is None, not a crash
        assert loaded['pat'] is None

    def test_wrong_key_returns_none_on_load(self, monkeypatch, tmp_path):
        """A PAT encrypted with key A must degrade to None when loaded with key B."""
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'key-A-llllllllllllllllllllllllll')
        from planner_lib.accounts.config import AccountCredentialsPayload
        storage = self._make_storage()
        mgr = self._make_manager(storage)
        mgr.update_credentials(AccountCredentialsPayload(email='user@example.com', pat='validtoken123'))

        # Switch to a different key (simulates key rotation or misconfiguration)
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'key-B-llllllllllllllllllllllllll')
        # Must not raise; pat returns None so session creation continues safely
        loaded = mgr.load('user@example.com')
        assert loaded['ok'] is True
        assert loaded['pat'] is None
