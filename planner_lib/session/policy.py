"""Versioned authentication policy, independent of backend content settings."""
from planner_lib.migrations.contracts import SchemaError


def initial_authentication():
    return {'version': 1, 'selected': 'enrollment', 'active': 'enrollment',
            'backend_credentials': 'pat', 'epoch': 1}


def validate_authentication(value):
    if (not isinstance(value, dict) or set(value) != set(initial_authentication())
            or value['version'] != 1 or type(value['epoch']) is not int or value['epoch'] < 1
            or value['selected'] not in ('enrollment', 'entra')
            or value['active'] not in ('enrollment', 'entra')
            or value['backend_credentials'] not in ('pat', 'delegated')
            or (value['active'] == 'entra') != (value['backend_credentials'] == 'delegated')):
        raise SchemaError('Invalid authentication policy')
    return value


class SessionPolicy:
    def __init__(self, storage=None):
        self.storage = storage

    def current(self):
        if self.storage is None:
            return initial_authentication()
        return validate_authentication(self.storage.load('config', 'authentication'))