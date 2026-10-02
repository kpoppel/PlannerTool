"""Supported historical transformations over explicitly supplied candidate storage."""

import json
from importlib.resources import files
from uuid import UUID, uuid4

from .contracts import (
    BASELINE_REVISION, MIGRATION_IDS, TARGET_REVISION, Migration, SchemaError,
    schema_state, validate_registry, validate_schema_state,
)

BASELINE_IDS = (
    '0000.initial-create-state', '0001.add-schema-field-to-scenarios-and-users',
    '0002.add-server-name-to-config', '0003.move-accounts-to-data-accounts',
    '0004.clear-azure-cache', '0005.add-project-map-type',
    '0006.split-server-config-into-projects-teams', '0007.rename-db-and-update-projects',
    '0008.remove-plugins-from-server-config', '0009.clear-azure-cache-key-format',
    '0010.teams-schema-v2-rename-team-map-to-teams', '0011.move-database-path-to-people-config',
    '0012.clear-cache-revision-tracking', '0013.projects-schema-v3-add-display-states',
    '0014.projects-states-capitalize', '0015.migrate-pickle-to-diskcache',
    '0016.add-memory-cache-config', '0017.encrypt-pats', '0018.permissions-field',
    '0019.display-mode-field', '0020.rename-enable-azure-cache-to-enable-cache',
    '0021.internalize-config-to-diskcache', '0022.migrate-people-to-diskcache',
    '0023.clean-ado-config-and-server-config', '0024.groups-members-and-pending-changes',
)

LEGACY_MARKER_IDS = {
    '0001.add-schema-field': '0001.add-schema-field-to-scenarios-and-users',
    '0009.clear-azure-cache-for-key-format': '0009.clear-azure-cache-key-format',
    '0012.clear-cache-for-revision-tracking': '0012.clear-cache-revision-tracking',
    '0015_migrate_pickle_to_diskcache': '0015.migrate-pickle-to-diskcache',
    '0027.add-missing-group-metadata-to-scenarios': MIGRATION_IDS[27],
}


def _payloads(storage, namespace):
    register_key = {'views': 'view_register', 'scenarios': 'scenario_register'}[namespace]
    for key in storage.list_keys(namespace):
        if key != register_key:
            yield key, storage.load(namespace, key)


def upgrade_26(storage):
    for key in list(storage.list_keys('backend_domain')):
        storage._cache.delete(storage._composite_key('backend_domain', key))


def upgrade_27(storage):
    for key, payload in _payloads(storage, 'scenarios'):
        migrated = dict(payload)
        for field in ('overrides', 'filters', 'view', 'groupOverrides', 'scenarioGroups'):
            expected = list if field == 'scenarioGroups' else dict
            if not isinstance(migrated.get(field), expected):
                migrated[field] = expected()
        storage.save('scenarios', key, migrated)


def upgrade_28(storage):
    used = set()
    for email in storage.list_keys('accounts'):
        account = dict(storage.load('accounts', email))
        account_id = account.get('account_id')
        if account_id is None:
            account_id = str(uuid4())
            account['account_id'] = account_id
        if str(UUID(account_id)) != account_id or account_id in used:
            raise SchemaError('Account IDs must be canonical and unique')
        used.add(account_id)
        storage.save('accounts', email, account)


def upgrade_29(storage):
    fields = {'expandRelations': ('dependency',),
              'expandTeamAllocated': ('otherAllocations',),
              'expandParentChild': ('parent', 'child')}
    for key, view in _payloads(storage, 'views'):
        options = view.get('viewOptions')
        if not isinstance(options, dict) or not any(field in options for field in fields):
            continue
        options = dict(options)
        context = dict(options.get('context', {}))
        for field, targets in fields.items():
            enabled = bool(options.pop(field, False))
            for target in targets:
                context[target] = bool(context.get(target)) or enabled
        storage.save('views', key, {**view, 'viewOptions': {**options, 'context': context}})


def upgrade_30(storage):
    config = storage.load('config', 'projects')
    if 'container_types' not in config:
        storage.save('config', 'projects', {**config, 'container_types': ['project', 'team']})


def upgrade_31(storage):
    for email in storage.list_keys('accounts'):
        account_id = storage.load('accounts', email)['account_id']
        if not storage.exists('account_auth', account_id):
            storage.save('account_auth', account_id, {'enrolled': False})


def upgrade_32(storage):
    owners = {email: storage.load('accounts', email)['account_id']
              for email in storage.list_keys('accounts')}
    for namespace, register_key in (('views', 'view_register'), ('scenarios', 'scenario_register')):
        register = storage.load(namespace, register_key) if storage.exists(namespace, register_key) else {}
        migrated = dict(register)
        keys = set(storage.list_keys(namespace)) | set(register)
        keys.discard(register_key)
        for key in sorted(keys):
            if key in register:
                owner, item_id = register[key]['user'], register[key]['id']
                if key != owner + '_' + item_id:
                    raise SchemaError('Invalid user-data register key')
            else:
                owner, separator, item_id = key.partition('_')
                if not separator:
                    raise SchemaError('Invalid user-data key')
                try:
                    UUID(owner)
                except ValueError:
                    owner, _, item_id = key.rpartition('_')
                    for email in owners:
                        if key.startswith(email + '_'):
                            owner, item_id = email, key[len(email) + 1:]
                            break
            if owner not in owners:
                try:
                    owners[owner] = str(UUID(owner))
                except ValueError:
                    owners[owner] = str(uuid4())
            account_id = owners[owner]
            new_key = account_id + '_' + item_id
            if new_key == key:
                continue
            if new_key in keys or new_key in migrated:
                raise SchemaError('User-data ownership collision')
            if key in register:
                del migrated[key]
                migrated[new_key] = {**register[key], 'user': account_id}
            if storage.exists(namespace, key):
                storage.save(namespace, new_key, storage.load(namespace, key))
                storage.delete(namespace, key)
        storage.save(namespace, register_key, migrated)
    for key in list(storage.list_keys('auth_sessions')):
        if 'account_id' not in storage.load('auth_sessions', key):
            storage.delete('auth_sessions', key)


def menu_positions():
    resource = json.loads(files(__package__).joinpath('menu_positions_0033.json').read_text())
    if not isinstance(resource, dict) or any(
        value not in ('before-tools', 'after-tools') for value in resource.values()
    ):
        raise SchemaError('Invalid packaged migration resource')
    return resource


def upgrade_33(storage):
    from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config

    positions = menu_positions()
    if not storage.exists('config', 'plugin_runtime_config'):
        return
    payload = storage.load('config', 'plugin_runtime_config')
    if isinstance(payload, dict) and payload.get('schema_version') == 2:
        if all('activated' not in entry and 'order' not in entry for entry in payload['plugins']):
            storage.save('config', 'plugin_runtime_config', normalize_plugin_runtime_config(payload))
            return
    entries = payload if isinstance(payload, list) else payload['plugins']
    migrated = []
    for entry in entries:
        plugin_id = entry['id']
        result = {'id': plugin_id, 'enabled': entry.get('enabled', True),
                  'activateOnStartup': entry.get('activated', False),
                  'custom_config': entry.get('custom_config', {})}
        if plugin_id in positions:
            result['activateOnStartup'] = False
            result['menuPosition'] = entry.get('menuPosition', positions[plugin_id])
        migrated.append(result)
    storage.save('config', 'plugin_runtime_config', normalize_plugin_runtime_config(
        {'schema_version': 2, 'plugins': migrated}))


REGISTRY = tuple(
    Migration(revision, predecessor, MIGRATION_IDS[revision], upgrade)
    for revision, predecessor, upgrade in (
        (26, 24, upgrade_26), (27, 26, upgrade_27), (28, 27, upgrade_28),
        (29, 28, upgrade_29), (30, 29, upgrade_30), (31, 30, upgrade_31),
        (32, 31, upgrade_32), (33, 32, upgrade_33),
    )
)


def initialize(storage):
    defaults = {
        'server_config': {'schema_version': 2, 'log_level': 'INFO', 'feature_flags': {}},
        'projects': {'schema_version': 3, 'project_map': [], 'container_types': ['project', 'team']},
        'people': {'schema_version': 1, 'database': {'people': []}},
        'teams': {'schema_version': 2, 'teams': []},
        'ado_config': {'organization_url': '', 'feature_flags': {}},
        'plugin_runtime_config': {'schema_version': 2, 'plugins': []},
    }
    for key, value in defaults.items():
        if not storage.exists('config', key):
            storage.save('config', key, value)
    storage.save('system', 'schema_state', schema_state(TARGET_REVISION, initialized=True))


def admit_legacy(storage, ledger, *, server_config=None):
    if not isinstance(ledger, dict) or not isinstance(ledger.get('applied'), list):
        raise SchemaError('Missing legacy migration evidence; inspect the ledger offline')
    applied = ledger['applied']
    known = {*BASELINE_IDS, *MIGRATION_IDS.values(), *LEGACY_MARKER_IDS}
    if any(not isinstance(item, str) or item not in known for item in applied):
        raise SchemaError('Unverifiable legacy migration ledger; baseline v4.2.1 is required')
    if len(applied) != len(set(applied)):
        raise SchemaError('Unverifiable legacy migration ledger; baseline v4.2.1 is required')
    # Development ledgers can contain both names after a known migration rename.
    applied = {LEGACY_MARKER_IDS.get(item, item) for item in applied}
    if not set(BASELINE_IDS).issubset(applied):
        raise SchemaError('Unverifiable legacy migration ledger; baseline v4.2.1 is required')
    revision = BASELINE_REVISION
    gap = False
    for next_revision, migration_id in MIGRATION_IDS.items():
        if migration_id not in applied:
            gap = True
        elif gap:
            raise SchemaError('Legacy migration ledger has a missing transition')
        else:
            revision = next_revision
    validate_records(storage, revision, server_config=server_config)
    return revision


def validate_records(storage, revision, *, server_config=None):
    from planner_lib.accounts.config import _decrypt_pat, _is_valid_email
    from planner_lib.admin.config_manager import ConfigManager
    from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config

    try:
        server = storage.load('config', 'server_config') if server_config is None else server_config
        projects = storage.load('config', 'projects')
        people = storage.load('config', 'people')
        if (server['schema_version'] != 2 or not isinstance(server['feature_flags'], dict)
                or projects['schema_version'] != 3
                or ('schema_version' in people and people['schema_version'] != 1)
                or not isinstance(people['database']['people'], list)
                or 'enable_azure_cache' in server['feature_flags']):
            raise SchemaError('Legacy configuration invariants disagree with the ledger')
        for key in storage.list_keys('config'):
            if key != 'plugin_runtime_config' and not isinstance(storage.load('config', key), dict):
                raise SchemaError('Configuration records must be objects')
        if revision >= 30:
            containers = projects['container_types']
            if (not isinstance(containers, list) or not containers
                    or len(set(containers)) != len(containers)
                    or any(not isinstance(item, str) or not item for item in containers)
                    or any(project.get('type', 'project') not in containers
                           for project in projects.get('project_map', []))):
                raise SchemaError('Invalid project container hierarchy')
        account_ids = set()
        for email in storage.list_keys('accounts'):
            account = storage.load('accounts', email)
            if (not _is_valid_email(email) or account['email'] != email
                    or not isinstance(account['permissions'], list)
                    or any(not isinstance(permission, str) for permission in account['permissions'])):
                raise SchemaError('Invalid account contract')
            if account.get('pat'):
                _decrypt_pat(account['pat'])
            if revision >= 28:
                account_id = account['account_id']
                if str(UUID(account_id)) != account_id or account_id in account_ids:
                    raise SchemaError('Invalid or duplicate account ID')
                account_ids.add(account_id)
                if revision >= 31:
                    auth = storage.load('account_auth', account_id)
                    if type(auth['enrolled']) is not bool:
                        raise SchemaError('Invalid enrollment state')
        if revision >= 31:
            ConfigManager(storage)._validate_authentication({
                'accounts': {'users': {email: storage.load('accounts', email)
                                       for email in storage.list_keys('accounts')}},
                'authentication': {
                    'account_auth': {key: storage.load('account_auth', key)
                                     for key in storage.list_keys('account_auth')},
                    'auth_control': {key: storage.load('auth_control', key)
                                     for key in storage.list_keys('auth_control')},
                },
            })
        for namespace in ('views', 'scenarios'):
            for key, payload in _payloads(storage, namespace):
                if not isinstance(payload, dict):
                    raise SchemaError('Invalid user-data payload')
                if revision >= 32:
                    owner, separator, item_id = key.partition('_')
                    if not separator or not item_id or str(UUID(owner)) != owner:
                        raise SchemaError('Invalid account-ID ownership')
                if namespace == 'scenarios' and revision >= 27:
                    for field in ('overrides', 'filters', 'view', 'groupOverrides', 'scenarioGroups'):
                        if not isinstance(payload[field], list if field == 'scenarioGroups' else dict):
                            raise SchemaError('Scenario metadata disagrees with the ledger')
                if namespace == 'views' and revision >= 29:
                    if any(field in payload.get('viewOptions', {}) for field in (
                        'expandRelations', 'expandTeamAllocated', 'expandParentChild'
                    )):
                        raise SchemaError('Saved-view metadata disagrees with the ledger')
            register_key = 'view_register' if namespace == 'views' else 'scenario_register'
            if storage.exists(namespace, register_key):
                for key, entry in storage.load(namespace, register_key).items():
                    if key != entry['user'] + '_' + entry['id']:
                        raise SchemaError('Invalid user-data register ownership')
                    if revision >= 32 and str(UUID(entry['user'])) != entry['user']:
                        raise SchemaError('Invalid register owner')
        if revision >= 33 and storage.exists('config', 'plugin_runtime_config'):
            payload = storage.load('config', 'plugin_runtime_config')
            if normalize_plugin_runtime_config(payload) != payload:
                raise SchemaError('Noncanonical plugin runtime configuration')
        menu_positions()
    except SchemaError:
        raise
    except Exception as error:
        raise SchemaError('Database records fail schema or credential validation ('
                          + type(error).__name__ + ')') from None


def validate_candidate(storage):
    validate_registry(REGISTRY)
    revision = validate_schema_state(storage.load('system', 'schema_state'))
    if revision != TARGET_REVISION:
        raise SchemaError('Candidate did not reach the target schema')
    if storage.get_expire_time('system', 'schema_state') is not None:
        raise SchemaError('Schema metadata must not expire')
    if storage._cache.check():
        raise SchemaError('Candidate DiskCache integrity check failed')
    validate_records(storage, revision)