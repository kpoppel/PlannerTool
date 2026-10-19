"""Supported historical transformations over explicitly supplied candidate storage."""

import json
from importlib.resources import files
import re
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


def upgrade_34(storage):
    for key, view in _payloads(storage, 'views'):
        options = dict(view.get('viewOptions', {}))
        filters = dict(options.get('taskFilters', {}))
        schedule = dict(filters.get('schedule', {}))
        if 'packedModeUnplannedPreference' not in options:
            options['packedModeUnplannedPreference'] = schedule.get('unplanned', True)
        if options.get('displayMode') == 'packed':
            options['taskFilters'] = {**filters, 'schedule': {**schedule, 'unplanned': False}}
        storage.save('views', key, {**view, 'viewOptions': options})


def upgrade_35(storage):
    from .workforce_candidate import upgrade_workforce_candidate

    upgrade_workforce_candidate(storage)


def _project_area_path_matches(project_area, mapped_area):
    project_area = project_area.strip('/\\').replace('/', '\\').casefold()
    mapped_area = mapped_area.strip('/\\').replace('/', '\\').casefold()
    return (
        mapped_area == project_area
        or mapped_area.startswith(project_area + '\\')
        or project_area.startswith(mapped_area + '\\')
    )


def _remap_selected_project_ids(value, aliases):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key == 'selectedProjects' and isinstance(item, dict):
                selections = {}
                for project_id, selected in item.items():
                    for new_id in aliases.get(project_id, [project_id]):
                        if new_id in selections and selections[new_id] != selected:
                            raise SchemaError('Conflicting saved project selections during ID migration')
                        selections[new_id] = selected
                result[key] = selections
            elif key in {'projects', 'projectIds'} and isinstance(item, list):
                remapped = []
                for project_id in item:
                    remapped.extend(aliases.get(project_id, [project_id]))
                result[key] = list(dict.fromkeys(remapped))
            else:
                result[key] = _remap_selected_project_ids(item, aliases)
        return result
    if isinstance(value, list):
        return [_remap_selected_project_ids(item, aliases) for item in value]
    return value


def upgrade_36(storage):
    from collections import defaultdict
    from uuid import UUID

    with storage.transaction():
        config = storage.load('config', 'projects')
        project_map = config.get('project_map')
        if not isinstance(project_map, list):
            raise SchemaError('Invalid project map during project-ID migration')

        aliases = defaultdict(list)
        used_ids = set()
        migrated_projects = []
        for project in project_map:
            if not isinstance(project, dict) or not isinstance(project.get('name'), str):
                raise SchemaError('Invalid project entry during project-ID migration')
            legacy_id = _legacy_project_id(project['name'])
            project_id = project.get('id')
            if project_id is None:
                project_id = str(uuid4())
                while project_id in used_ids:
                    project_id = str(uuid4())
            try:
                if str(UUID(project_id)) != project_id or project_id in used_ids:
                    raise ValueError
            except (TypeError, ValueError):
                raise SchemaError('Project IDs must be unique canonical UUIDs') from None
            used_ids.add(project_id)
            aliases[legacy_id].append(project_id)
            migrated_projects.append({**project, 'id': project_id})

        area_plan_map = (
            storage.load('config', 'area_plan_map')
            if storage.exists('config', 'area_plan_map')
            else {}
        )
        if not isinstance(area_plan_map, dict):
            raise SchemaError('Invalid area-plan map during project-ID migration')
        migrated_area_plan_map = {}
        for old_id, entry in area_plan_map.items():
            project_ids = aliases.get(old_id)
            if not project_ids:
                migrated_area_plan_map[old_id] = entry
                continue
            projects = [
                project for project in migrated_projects
                if _legacy_project_id(project['name']) == old_id
            ]
            if not isinstance(entry, dict):
                raise SchemaError('Invalid project area mapping during project-ID migration')
            areas = entry.get('areas')
            if not isinstance(areas, dict):
                if len(projects) != 1:
                    raise SchemaError('Ambiguous project area mapping during project-ID migration')
                migrated_area_plan_map[project_ids[0]] = entry
                continue
            areas_by_project = {project['id']: {} for project in projects}
            for area_path, area_data in areas.items():
                matches = [
                    project for project in projects
                    if project.get('area_path')
                    and _project_area_path_matches(project['area_path'], area_path)
                ]
                if not matches:
                    if len(projects) == 1:
                        matches = projects
                    else:
                        raise SchemaError('Ambiguous project area mapping during project-ID migration')
                longest = max(len(project['area_path'].strip('/\\')) for project in matches)
                owners = [
                    project for project in matches
                    if len(project['area_path'].strip('/\\')) == longest
                ]
                if len(owners) != 1:
                    raise SchemaError('Ambiguous project area mapping during project-ID migration')
                areas_by_project[owners[0]['id']][area_path] = area_data
            for project in projects:
                migrated_area_plan_map[project['id']] = {
                    **{key: value for key, value in entry.items() if key != 'areas'},
                    'areas': areas_by_project[project['id']],
                }

        storage.save('config', 'projects', {**config, 'project_map': migrated_projects})
        if storage.exists('config', 'area_plan_map'):
            storage.save('config', 'area_plan_map', migrated_area_plan_map)
        for namespace in ('views', 'scenarios'):
            for key, payload in _payloads(storage, namespace):
                storage.save(namespace, key, _remap_selected_project_ids(payload, aliases))
        for key in list(storage.list_keys('backend_domain')):
            storage.delete('backend_domain', key)


def _legacy_project_id(name):
    """Recognize pre-revision-36 project handles only while migrating their references."""
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return f'project-{slug}'


def _remap_team_id_references(value, aliases):
    if isinstance(value, dict):
        return {
            aliases.get(key, key) if isinstance(key, str) else key:
                _remap_team_id_references(item, aliases)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_remap_team_id_references(item, aliases) for item in value]
    if isinstance(value, str):
        return aliases.get(value, value)
    return value


def upgrade_37(storage):
    from planner_lib.domain.teams import TeamCatalogue

    with storage.transaction():
        config = storage.load('config', 'teams')
        TeamCatalogue(config)
        projects = storage.load('config', 'projects')
        project_ids = {item['id'] for item in projects['project_map']}
        group_ids = {item['id'] for item in config['groups']}
        workforce = storage.load('config', 'workforce')
        workforce_ids = {supplier['id'] for supplier in workforce['suppliers']}
        workforce_ids.update(
            profile['id']
            for supplier in workforce['suppliers']
            for profile in supplier['profiles']
        )
        workforce_ids.update(row['id'] for row in workforce['staffing'])
        used_ids = project_ids | group_ids | workforce_ids
        aliases = {}
        teams = []
        for team in config['teams']:
            team_id = str(uuid4())
            while team_id in used_ids:
                team_id = str(uuid4())
            aliases[team['id']] = team_id
            used_ids.add(team_id)
            teams.append({**team, 'id': team_id})
        migrated_staffing = [
            {**row, 'team_id': aliases[row['team_id']]}
            for row in workforce['staffing']
        ]
        migrated_projects = dict(projects)
        migrated_projects['allocation_defaults'] = _remap_team_id_references(
            projects['allocation_defaults'], aliases,
        )
        migrated_projects['project_map'] = [
            {
                **project,
                **({'allocatable_ids': _remap_team_id_references(
                    project['allocatable_ids'], aliases,
                )} if 'allocatable_ids' in project else {}),
            }
            for project in projects['project_map']
        ]
        storage.save('config', 'teams', {**config, 'teams': teams})
        storage.save('config', 'workforce', {**workforce, 'staffing': migrated_staffing})
        storage.save('config', 'projects', migrated_projects)
        if (storage.exists('config', 'event_config')
                and storage.load('config', 'event_config').get('event_backend') == 'ado_wiki'):
            storage.delete('config', 'event_config')
        for namespace in ('views', 'scenarios'):
            for key, payload in _payloads(storage, namespace):
                storage.save(namespace, key, _remap_team_id_references(payload, aliases))
        for namespace in ('backend_domain', 'cost_cache'):
            for key in list(storage.list_keys(namespace)):
                storage.delete(namespace, key)


def upgrade_38(storage):
    from planner_lib.admin.workforce_config import _timestamp_identity
    from planner_lib.domain.teams import TeamCatalogue

    with storage.transaction():
        config = storage.load('config', 'teams')
        TeamCatalogue(config)
        projects = storage.load('config', 'projects')
        workforce = storage.load('config', 'workforce')
        used_ids = {
            identity.lower()
            for identity in (
                [project['id'] for project in projects['project_map']]
                + [group['id'] for group in config['groups']]
                + [supplier['id'] for supplier in workforce['suppliers']]
                + [profile['id'] for supplier in workforce['suppliers']
                   for profile in supplier['profiles']]
                + [row['id'] for row in workforce['staffing']]
                + [team['id'] for team in config['teams']]
            )
        }
        used_ids.update(
            definition['allocation_token'].strip().lower()
            for definition in [*config['teams'], *config['groups']]
        )
        aliases = {}
        teams = []
        for team in config['teams']:
            team_id = _timestamp_identity()
            while team_id.lower() in used_ids:
                team_id = _timestamp_identity()
            aliases[team['id']] = team_id
            used_ids.add(team_id.lower())
            teams.append({**team, 'id': team_id})

        project_map = []
        for project in projects['project_map']:
            migrated_project = dict(project)
            if 'allocatable_ids' in project:
                migrated_project['allocatable_ids'] = _remap_team_id_references(
                    project['allocatable_ids'], aliases,
                )
            project_map.append(migrated_project)

        storage.save('config', 'teams', {**config, 'teams': teams})
        storage.save('config', 'workforce', {
            **workforce,
            'staffing': [
                {**row, 'team_id': aliases[row['team_id']]}
                for row in workforce['staffing']
            ],
        })
        migrated_projects = {
            **projects,
            'allocation_defaults': _remap_team_id_references(
                projects['allocation_defaults'], aliases,
            ),
            'project_map': project_map,
        }
        storage.save('config', 'projects', migrated_projects)
        for namespace in ('views', 'scenarios'):
            for key, payload in _payloads(storage, namespace):
                storage.save(namespace, key, _remap_team_id_references(payload, aliases))
        for namespace in ('backend_domain', 'cost_cache'):
            for key in list(storage.list_keys(namespace)):
                storage.delete(namespace, key)


def upgrade_39(storage):
    with storage.transaction():
        projects = storage.load('config', 'projects')
        plans = []
        for project in projects['project_map']:
            plan = dict(project)
            plan.pop('include_states', None)
            plan.pop('display_states', None)
            plan['closed_history_days'] = 0
            plans.append(plan)
        storage.save('config', 'projects', {**projects, 'project_map': plans})
        storage.save('config', 'ado_processes', {'schema_version': 1, 'processes': []})
        storage.save('config', 'global_settings', {
            'schema_version': 2, 'process_order': [], 'type_tiers': {},
        })


def upgrade_40(storage):
    with storage.transaction():
        projects = storage.load('config', 'projects')
        plans = []
        for project in projects['project_map']:
            plan = dict(project)
            plan.pop('completed_retention_months', None)
            plans.append(plan)
        storage.save('config', 'projects', {**projects, 'project_map': plans})


def upgrade_41(storage):
    with storage.transaction():
        projects = storage.load('config', 'projects')
        catalogue = storage.load('config', 'ado_processes')
        process_by_project = {
            project.casefold(): process
            for process in catalogue['processes'] for project in process['projects']
        }
        plans = []
        for project in projects['project_map']:
            plan = dict(project)
            ado_project = plan['area_path'].replace('/', '\\').lstrip('\\').split('\\')[0].casefold()
            process = process_by_project.get(ado_project)
            if process is not None:
                task_types = {item['name'].casefold() for item in process['types']
                              if item['backlog_level'] == 'task'}
                selected = [name for name in plan['task_types']
                            if name.casefold() not in task_types]
                if not selected:
                    raise SchemaError(
                        f"Plan {plan['name']} must select an eligible work item type before upgrading",
                    )
                plan['task_types'] = selected
            plans.append(plan)
        storage.save('config', 'projects', {**projects, 'project_map': plans})


def _remap_saved_plan_references(value, aliases):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key in {'plan_id', 'planId', 'project', 'projectId', 'focusedPlanId'} and isinstance(item, str):
                project_ids = aliases.get(item, [item])
                if len(project_ids) != 1:
                    raise SchemaError(f'Ambiguous saved group/task plan reference: {item}')
                result[key] = project_ids[0]
            else:
                result[key] = _remap_saved_plan_references(item, aliases)
        return result
    if isinstance(value, list):
        return [_remap_saved_plan_references(item, aliases) for item in value]
    return value


def upgrade_42(storage):
    with storage.transaction():
        projects = storage.load('config', 'projects')['project_map']
        aliases = {}
        for project in projects:
            aliases.setdefault(_legacy_project_id(project['name']), []).append(project['id'])
        for namespace in ('views', 'scenarios'):
            for key, payload in _payloads(storage, namespace):
                migrated = _remap_selected_project_ids(payload, aliases)
                migrated = _remap_saved_plan_references(migrated, aliases)
                storage.save(namespace, key, migrated)


def upgrade_43(storage) -> None:
    """Preserve existing ADO sets as explicit, dated snapshots."""
    from planner_lib.domain.iteration_sets import validate_iteration_sets

    with storage.transaction():
        content = storage.load('config', 'iterations') if storage.exists('config', 'iterations') else {}
        sets = []
        for old in content.get('iteration_sets', []):
            values = old.get('values', [])
            sets.append({
                **old, 'source_type': 'ado', 'generator': None,
                'selected_paths': [value['path'] for value in values],
                'values': [value for value in values
                           if value.get('startDate') and value.get('finishDate')],
            })
        storage.save('config', 'iterations', validate_iteration_sets({'iteration_sets': sets}))


REGISTRY = tuple(
    Migration(revision, predecessor, MIGRATION_IDS[revision], upgrade)
    for revision, predecessor, upgrade in (
        (26, 24, upgrade_26), (27, 26, upgrade_27), (28, 27, upgrade_28),
        (29, 28, upgrade_29), (30, 29, upgrade_30), (31, 30, upgrade_31),
        (32, 31, upgrade_32), (33, 32, upgrade_33), (34, 33, upgrade_34),
        (35, 34, upgrade_35), (36, 35, upgrade_36), (37, 36, upgrade_37),
        (38, 37, upgrade_38), (39, 38, upgrade_39), (40, 39, upgrade_40),
        (41, 40, upgrade_41), (42, 41, upgrade_42), (43, 42, upgrade_43),
    )
)


def initialize(storage):
    defaults = {
        'server_config': {'schema_version': 2, 'log_level': 'INFO', 'feature_flags': {}},
        'projects': {'schema_version': 4, 'project_map': [], 'container_types': ['project', 'team'],
                 'allocation_defaults': {'project': [], 'team': []}},
        'teams': {'schema_version': 3, 'teams': [], 'groups': []},
        'workforce': {'schema_version': 2, 'suppliers': [], 'staffing': []},
        'ado_config': {'organization_url': '',
                   'feature_flags': {'use_azure_mock_generator': True}},
        'ado_processes': {'schema_version': 1, 'processes': []},
        'global_settings': {'schema_version': 2, 'process_order': [], 'type_tiers': {}},
        'plugin_runtime_config': {'schema_version': 2, 'plugins': []},
        'iterations': {'iteration_sets': []},
    }
    for key, value in defaults.items():
        if not storage.exists('config', key):
            storage.save('config', key, value)
    storage.save('system', 'schema_state', schema_state(TARGET_REVISION, initialized=True))
    storage.save('system', 'workforce_backend_refresh_required', False)


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
        if (server['schema_version'] != 2 or not isinstance(server['feature_flags'], dict)
                or 'enable_azure_cache' in server['feature_flags']):
            raise SchemaError('Server configuration invariants disagree with the ledger')
        if revision >= 35:
            from .workforce_candidate import validate_workforce_records

            validate_workforce_records(storage)
        else:
            people = storage.load('config', 'people')
            if (projects['schema_version'] != 3
                    or ('schema_version' in people and people['schema_version'] != 1)
                    or not isinstance(people['database']['people'], list)):
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
        if revision >= 36:
            project_ids = set()
            for project in projects['project_map']:
                project_id = project.get('id')
                try:
                    if str(UUID(project_id)) != project_id or project_id in project_ids:
                        raise ValueError
                except (TypeError, ValueError):
                    raise SchemaError('Invalid or duplicate project ID') from None
                project_ids.add(project_id)
        if revision >= 38:
            for team in storage.load('config', 'teams')['teams']:
                if not isinstance(team.get('id'), str) or not re.fullmatch(
                    r'[a-z2-7]{26}', team['id'],
                ):
                    raise SchemaError('Invalid team ID format')
        if revision >= 39:
            from planner_lib.azure.catalogue import validate_display
            catalogue = storage.load('config', 'ado_processes')
            if catalogue['schema_version'] != 1 or not isinstance(catalogue['processes'], list):
                raise SchemaError('Invalid process catalogue')
            validate_display(catalogue, storage.load('config', 'global_settings'))
            for project in projects['project_map']:
                if ('include_states' in project or 'display_states' in project
                        or type(project['closed_history_days']) is not int
                        or project['closed_history_days'] < 0):
                    raise SchemaError('Invalid revision 39 plan contract')
        if revision >= 40:
            for project in projects['project_map']:
                if 'completed_retention_months' in project:
                    raise SchemaError('Invalid revision 40 plan contract')
        if revision >= 41:
            catalogue = storage.load('config', 'ado_processes')
            process_by_project = {
                project.casefold(): process
                for process in catalogue['processes'] for project in process['projects']
            }
            for project in projects['project_map']:
                ado_project = project['area_path'].replace('/', '\\').lstrip('\\').split('\\')[0].casefold()
                process = process_by_project.get(ado_project)
                if process is not None:
                    task_types = {item['name'].casefold() for item in process['types']
                                  if item['backlog_level'] == 'task'}
                    if any(name.casefold() in task_types for name in project['task_types']):
                        raise SchemaError('Invalid revision 41 task-level plan selection')
        if revision >= 43:
            from planner_lib.domain.iteration_sets import validate_iteration_sets
            validate_iteration_sets(storage.load('config', 'iterations'))
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
                if namespace == 'views' and revision >= 34:
                    options = payload['viewOptions']
                    if type(options['packedModeUnplannedPreference']) is not bool:
                        raise SchemaError('Saved view requires a boolean packed-mode preference')
                    if (options.get('displayMode') == 'packed'
                            and options['taskFilters']['schedule']['unplanned'] is not False):
                        raise SchemaError('Packed views must exclude Unplanned tasks')
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