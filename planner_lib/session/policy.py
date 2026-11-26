"""Versioned authentication policy, independent of backend content settings."""
from planner_lib.migrations.contracts import NO_PAT_REVISION, TARGET_REVISION, SchemaError


def initial_authentication():
    return {'version': 1, 'selected': 'enrollment', 'active': 'enrollment',
            'backend_credentials': 'none', 'epoch': 1}


def validate_deployment_ado_authentication(mode):
    if mode == 'pat':
        raise ValueError('PLANNER_ADO_AUTHENTICATION=pat is no longer supported: Azure DevOps '
                         'personal access token authentication was removed; use entra (or disabled)')
    if mode is not None and mode not in ('disabled', 'entra'):
        raise ValueError('Invalid deployment ADO credential policy')


def live_ado_permitted():
    """Live ADO (and the ADO wiki) needs delegated Entra credentials; nothing else can reach it."""
    import os
    mode = os.environ.get('PLANNER_ADO_AUTHENTICATION')
    validate_deployment_ado_authentication(mode)
    return mode != 'disabled' and os.environ.get('PLANNER_AUTH_PROVIDER') == 'entra'


def validate_backend_policy(storage, key=None, content=None, *, overrides=None):
    import os
    from planner_lib.backend.selection import uses_live_ado

    if live_ado_permitted():
        return
    mode = os.environ.get('PLANNER_ADO_AUTHENTICATION')
    transport_keys = ('server_config', 'ado_config', 'events_config')
    # A save or restore that touches no transport key cannot change the transport policy.
    if key is not None or overrides is not None:
        touched = {key} | set(overrides if overrides is not None else ())
        if not touched.intersection(transport_keys):
            return
    reason = ('Deployment ADO policy disables' if mode == 'disabled'
              else 'Delegated ADO credentials require the Entra login provider for')
    configs = {}
    for name in ('server_config', 'ado_config'):
        if overrides is not None and name in overrides:
            configs[name] = overrides[name]
        else:
            configs[name] = content if key == name else storage.load('config', name)
    if uses_live_ado(configs['server_config'], configs['ado_config']):
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


def validate_authentication(value, revision=TARGET_REVISION):
    without_delegation = 'none' if revision >= NO_PAT_REVISION else 'pat'
    if (not isinstance(value, dict) or set(value) != set(initial_authentication())
            or value['version'] != 1 or type(value['epoch']) is not int or value['epoch'] < 1
            or value['selected'] not in ('enrollment', 'entra')
            or value['active'] not in ('enrollment', 'entra')
            or value['backend_credentials'] not in (without_delegation, 'delegated')
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