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
        from planner_lib.accounts.config import AccountIdentityPayload
        mgr = self._make_manager()
        result = mgr.create_account(AccountIdentityPayload(email=email))
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
        from planner_lib.accounts.config import AccountIdentityPayload
        mgr = self._make_manager()
        result = mgr.create_account(AccountIdentityPayload(email=email))
        assert not result['ok'], f"Expected {email!r} to be rejected, got {result}"


# ---------------------------------------------------------------------------
# 2. Account identity, secret derivation and restore
# ---------------------------------------------------------------------------

class TestAccountIdentity:
    """Accounts carry anonymous IDs and expose no credentials."""

    def test_fernet_setup_is_reused_and_replaced_on_secret_change(self, monkeypatch):
        from planner_lib.accounts.config import _get_fernet
        from cryptography.fernet import InvalidToken

        monkeypatch.setenv('PLANNER_SECRET_KEY', 'first-synthetic-cache-secret')
        first = _get_fernet()
        ciphertext = first.encrypt(b'first-user-secret')
        assert _get_fernet() is first
        assert first.decrypt(ciphertext) == b'first-user-secret'

        monkeypatch.setenv('PLANNER_SECRET_KEY', 'second-synthetic-cache-secret')
        second = _get_fernet()
        assert second is not first
        assert _get_fernet() is second
        with pytest.raises(InvalidToken):
            second.decrypt(ciphertext)

        monkeypatch.delenv('PLANNER_SECRET_KEY')
        with pytest.raises(RuntimeError, match='PLANNER_SECRET_KEY'):
            _get_fernet()

    def _make_storage(self):
        return MemoryStorage()

    def _make_manager(self, storage=None):
        from planner_lib.accounts.config import AccountManager
        return AccountManager(storage=storage or self._make_storage())

    def test_identity_payload_rejects_permissions(self):
        """The public identity contract must not accept authorization fields."""
        from pydantic import ValidationError
        from planner_lib.accounts.config import AccountIdentityPayload

        with pytest.raises(ValidationError):
            AccountIdentityPayload(
                email='admin@example.com',
                permissions=['admin'],
            )

    def test_account_id_is_assigned_and_preserved_on_permission_update(self, monkeypatch):
        from uuid import UUID
        from planner_lib.accounts.config import AccountIdentityPayload
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        storage = self._make_storage()
        mgr = self._make_manager(storage)

        result = mgr.create_account(
            AccountIdentityPayload(email='user@example.com')
        )
        account_id = result['id']
        UUID(account_id)

        mgr.set_permissions(account_id, ['admin'])

        assert mgr.get_account_id('user@example.com') == account_id
        assert mgr.get_account_by_id(account_id)['email'] == 'user@example.com'

    def test_list_accounts_exposes_ids_without_credentials(self, monkeypatch):
        from planner_lib.accounts.config import AccountIdentityPayload
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        storage = self._make_storage()
        mgr = self._make_manager(storage)
        result = mgr.create_account(
            AccountIdentityPayload(email='admin@example.com'),
            ['admin'],
        )

        assert mgr.list_accounts() == [{
            'id': result['id'],
            'email': 'admin@example.com',
            'permissions': ['admin'],
            'lastActive': None,
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
        from planner_lib.accounts.config import AccountIdentityPayload
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
        storage = self._make_storage()
        mgr = self._make_manager(storage)
        mgr.create_account(AccountIdentityPayload(email='user@example.com'))
        storage.list_keys = lambda ns: (_ for _ in ()).throw(AssertionError('storage scanned'))

        with pytest.raises(KeyError):
            mgr.get_account_by_id('user@example.com')
