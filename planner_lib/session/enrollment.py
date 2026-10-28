"""Enrollment login and profile projection over the existing authentication owner."""

from planner_lib.session.auth import DEVICE_AGE


class EnrollmentSessionBinding:
    def __init__(self, storage):
        self._storage = storage

    def validate(self, account_id, device_id, now, *, refresh):
        auth = self._storage.load('account_auth', account_id)
        if device_id is None:
            return type(auth['enrolled']) is bool
        device = auth['devices'].get(device_id)
        if device is None or device['expires'] <= now:
            return False
        if refresh:
            device['expires'] = now + DEVICE_AGE
            self._storage.save('account_auth', account_id, auth)
        return True


class EnrollmentLoginAdapter:
    def __init__(self, auth_manager, account_manager, storage):
        self._auth = auth_manager
        self._accounts = account_manager
        self._storage = storage

    def requires_account_key(self, email):
        return self._auth.requires_account_key(email)

    def enroll(self, email, name='', account_key='', pat=None):
        initial_setup = not self._storage.exists('auth_control', 'bootstrap_claimed')
        initial_setup = initial_setup and self._accounts.count_all_with_permission('admin') == 0
        device, next_key, session = self._auth.enroll(email, name, account_key, pat)
        profile = self.profile(self._accounts.get_account_id(email))
        return device, session, {
            'email': email, 'name': profile['name'], 'accountKey': next_key,
            'initialSetup': initial_setup,
        }

    def profile(self, account_id):
        record = self._storage.load('account_auth', account_id)
        return {
            'name': record['name'],
            'devices': [{'id': key, 'expires': value['expires']}
                        for key, value in record['devices'].items()],
        }

    def authenticate_device(self, device):
        return self._auth.authenticate_device(device)

    def reset(self, account_id):
        account = self._accounts.get_account_by_id(account_id)
        return self._auth.reset(account['email'])

    def delete_account(self, email, account_key):
        self._auth.delete_account(email, account_key)

    def revoke(self, email, device_id):
        self._auth.revoke(email, device_id)

    def throttle(self, identity, limit=30):
        self._auth.throttle(identity, limit=limit)