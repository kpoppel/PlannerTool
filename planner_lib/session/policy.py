"""Versioned authentication policy, independent of backend content settings."""
from planner_lib.migrations.contracts import SchemaError


def initial_authentication():
    return {'version': 1, 'selected': 'enrollment', 'active': 'enrollment',
            'backend_credentials': 'pat', 'epoch': 1}


def validate_backend_policy(storage, key=None, content=None, *, overrides=None):
    import os
    from planner_lib.backend.azure import AzureDevOpsBackend
    from planner_lib.backend.registry import get_active_class

    mode = os.environ.get('PLANNER_ADO_AUTHENTICATION')
    if mode is None:
        return
    if mode not in ('disabled', 'pat', 'entra'):
        raise ValueError('Invalid deployment ADO credential policy')
    if mode == 'pat' or (mode == 'entra' and os.environ.get('PLANNER_AUTH_PROVIDER') == 'entra'):
        return
    reason = ('Deployment ADO policy disables' if mode == 'disabled'
              else 'Deployment ADO policy requires a connected Entra auth service for')
    flags = {}
    for name in ('server_config', 'ado_config'):
        if overrides is not None and name in overrides:
            value = overrides[name]
        else:
            value = content if key == name else storage.load('config', name)
        flags.update(value['feature_flags'])
    if get_active_class(flags) is AzureDevOpsBackend:
        raise ValueError(reason + ' live ADO transport')
    if overrides is not None and 'events_config' in overrides:
        events = overrides['events_config']
    elif key == 'events_config':
        events = content
    elif storage.exists('config', 'events_config'):
        events = storage.load('config', 'events_config')
    else:
        return
    if events['event_backend'] == 'ado_wiki':
        raise ValueError(reason + ' remote wiki transport')


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