"""Pure workforce conversion and coordinator-owned revision-35 candidate upgrade."""
from collections.abc import Callable, Mapping
from copy import deepcopy
from math import isfinite
import re
from typing import Any

from planner_lib.admin.workforce_config import _timestamp_identity
from planner_lib.domain.allocation_availability import validate_project_availability
from planner_lib.domain.teams import TeamCatalogue
from planner_lib.domain.workforce import WorkforceCatalogue
from planner_lib.storage.base import StorageBackend


def _quantity(value: Any, context: str) -> float:
    quantity = float(value)
    if isinstance(value, bool) or not isfinite(quantity) or quantity < 0:
        raise ValueError(f'Invalid legacy workforce quantity: {context}')
    return quantity


def _legacy_team_handle(name: str) -> str:
    """Reconstruct the revision-35 team handle only to remap saved references."""
    return f"team-{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}"


def _legacy_staffing_team_handle(name: str) -> str:
    """Reconstruct unmatched revision-35 staffing handles for saved-reference migration."""
    base = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return base if base.startswith('team-') else f'team-{base}'


def _remap_legacy_team_references(value: Any, aliases: Mapping[str, list[str]]) -> Any:
    if isinstance(value, dict):
        return {
            _remap_legacy_team_reference(key, aliases):
                _remap_legacy_team_references(item, aliases)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_remap_legacy_team_references(item, aliases) for item in value]
    return _remap_legacy_team_reference(value, aliases)


def _remap_legacy_team_reference(value: Any, aliases: Mapping[str, list[str]]) -> Any:
    if not isinstance(value, str) or value not in aliases:
        return value
    return aliases[value][0]
#    matches = aliases[value]
#    if len(matches) != 1:
#        raise ValueError(f'Ambiguous legacy team reference: {value}')
#    return matches[0]


def build_workforce_candidate(
    teams_config: Mapping[str, Any], people_config: Mapping[str, Any],
    cost_config: Mapping[str, Any], projects_config: Mapping[str, Any],
    *, id_issuer: Callable[[], str] = _timestamp_identity,
) -> dict[str, Any]:
    """Preserve observed anonymous bases, retaining unmatched staffing as archived review items."""
    if teams_config['schema_version'] != 2 or projects_config['schema_version'] != 3:
        raise ValueError('Workforce conversion requires teams v2 and projects v3')
    records = people_config['database']['people']
    used = {
        team['short_name'].strip().lower()
        for team in teams_config['teams']
    }

    def issue() -> str:
        while True:
            identity = id_issuer()
            if not isinstance(identity, str) or not identity.strip() or identity != identity.strip():
                raise ValueError('Migration identity issuer must return a nonempty opaque ID')
            if identity not in used and identity.lower() not in used:
                used.add(identity)
                used.add(identity.lower())
                return identity

    definitions = []
    allocation_tokens = set()
    teams_by_name: dict[str, list[dict[str, Any]]] = {}
    for team in teams_config['teams']:
        identity = issue()
        allocation_token = team['short_name']
        if allocation_token.strip().lower() in allocation_tokens:
            allocation_token = identity
        allocation_tokens.add(allocation_token.strip().lower())
        definition = {
            'id': identity, 'allocation_token': allocation_token, 'name': team['name'],
            'short_name': team['short_name'], 'archived': bool(team.get('exclude', False)),
            'group_id': None,
        }
        definitions.append(definition)
        for label in {team['name'].strip().casefold(), team['short_name'].strip().casefold()}:
            teams_by_name.setdefault(label, []).append(definition)

    TeamCatalogue({'schema_version': 3, 'teams': definitions, 'groups': []})
    unknown_teams: dict[str, dict[str, Any]] = {}
    for person in records:
        raw_team = person.get('team_name') or person.get('team') or ''
        normalized_team = raw_team.strip().casefold()
        matches = teams_by_name.get(normalized_team, [])
        if len(matches) > 1:
            raise ValueError(f'Ambiguous legacy staffing team: {raw_team}')
        if matches or normalized_team in unknown_teams:
            continue
        label = raw_team.strip() if raw_team.strip() else 'Unassigned staffing'
        identity = issue()
        unknown_teams[normalized_team] = {
            'id': identity, 'allocation_token': identity, 'name': label,
            'short_name': label, 'archived': True, 'group_id': None,
            'migration_incomplete': True,
        }
    definitions.extend(unknown_teams.values())
    team_configuration = {'schema_version': 3, 'teams': definitions, 'groups': []}
    initial = TeamCatalogue(team_configuration)
    available = [team['id'] for team in initial.allocation_choices()]
    by_name = {
        label: matches[0]['id'] for label, matches in teams_by_name.items()
    }
    by_name.update({label: team['id'] for label, team in unknown_teams.items()})

    suppliers: dict[tuple[str, bool], dict[str, Any]] = {}
    profiles: dict[tuple[str, float, float], dict[str, Any]] = {}
    staffing: dict[tuple[str, str, str], dict[str, Any]] = {}
    for person in records:
        raw_team = person.get('team_name') or person.get('team') or ''
        identity = by_name[raw_team.strip().casefold()]
        site = person.get('site') or ''
        external = bool(person.get('external'))
        supplier_key = (site, external)
        if supplier_key not in suppliers:
            provider = site if site else 'Unspecified provider'
            suppliers[supplier_key] = {
                'id': issue(), 'name': f'External at {provider}' if external else provider,
                'external': external, 'archived': False, 'profiles': [],
            }
        supplier = suppliers[supplier_key]
        account = 'external' if external else 'internal'
        hours = float(int(cost_config.get('working_hours', {}).get(site, {}).get(account, 0)))
        if external:
            external_cost = cost_config.get('external_cost', {})
            rate_value = external_cost.get('external', {}).get(
                person.get('name'), external_cost.get('default_hourly_rate', 0),
            )
        else:
            rate_value = cost_config.get('internal_cost', {}).get('default_hourly_rate', 0)
        rate = _quantity(0 if rate_value is None else rate_value, 'hourly rate')
        hours = _quantity(hours, 'monthly hours')
        profile_key = (supplier['id'], hours, rate)
        if profile_key not in profiles:
            profile = {'id': issue(), 'name': f'Profile {len(supplier["profiles"]) + 1}',
                       'monthly_project_hours': hours, 'hourly_rate': rate, 'archived': False}
            profiles[profile_key] = profile
            supplier['profiles'].append(profile)
        profile = profiles[profile_key]
        staffing_key = (identity, supplier['id'], profile['id'])
        if staffing_key not in staffing:
            staffing[staffing_key] = {
                'id': issue(), 'team_id': identity, 'supplier_id': supplier['id'],
                'profile_id': profile['id'], 'fte': 0.0,
            }
        staffing[staffing_key]['fte'] += 1.0
    workforce_configuration = {
        'schema_version': 2, 'suppliers': list(suppliers.values()), 'staffing': list(staffing.values()),
    }
    catalogue = TeamCatalogue(team_configuration)
    workforce = WorkforceCatalogue(workforce_configuration, catalogue)
    workforce.group_bases()
    projects = deepcopy(dict(projects_config))
    projects['schema_version'] = 4
    projects['allocation_defaults'] = {
        container: list(available) for container in projects['container_types']
    }
    return {
        'teams': team_configuration, 'workforce': workforce_configuration, 'projects': projects,
        'report': {
            'source_rows': len(records), 'staffing_fte': sum(row['fte'] for row in staffing.values()),
            'incomplete_team_ids': sorted(
                team['id'] for team in definitions if team.get('migration_incomplete', False)
            ),
            'team_bases': workforce.team_bases(),
        },
    }


def upgrade_workforce_candidate(storage: StorageBackend) -> dict[str, Any]:
    """Convert only the supplied candidate store, atomically, without remote writes."""
    with storage.transaction():
        if storage.exists('config', 'workforce'):
            raise ValueError('Workforce candidate already contains canonical workforce data')
        legacy_cost = storage.load('config', 'cost_config') if storage.exists('config', 'cost_config') else {}
        candidate = build_workforce_candidate(
            storage.load('config', 'teams'), storage.load('config', 'people'),
            legacy_cost, storage.load('config', 'projects'),
        )
        legacy_teams = storage.load('config', 'teams')['teams']
        migrated_teams = candidate['teams']['teams'][:len(legacy_teams)]
        legacy_team_ids: dict[str, list[str]] = {}
        for legacy_team, migrated_team in zip(legacy_teams, migrated_teams):
            legacy_id = _legacy_team_handle(legacy_team['name'])
            legacy_team_ids.setdefault(legacy_id, []).append(migrated_team['id'])
        incomplete_teams = {
            team['name'].strip().casefold(): team['id']
            for team in candidate['teams']['teams']
            if team.get('migration_incomplete', False)
        }
        for person in storage.load('config', 'people')['database']['people']:
            raw_team = person.get('team_name') or person.get('team') or ''
            normalized_team = raw_team.strip().casefold()
            if any(
                normalized_team in {team['name'].strip().casefold(),
                                    team['short_name'].strip().casefold()}
                for team in legacy_teams
            ):
                continue
            label = raw_team.strip() if raw_team.strip() else 'Unassigned staffing'
            legacy_id = _legacy_staffing_team_handle(raw_team)
            legacy_team_ids.setdefault(legacy_id, []).append(
                incomplete_teams[label.casefold()],
            )
        catalogue = TeamCatalogue(candidate['teams'])
        WorkforceCatalogue(candidate['workforce'], catalogue)
        validate_project_availability(candidate['projects'], catalogue.definitions())
        for namespace, register_key in (
            ('views', 'view_register'), ('scenarios', 'scenario_register'),
        ):
            for key in storage.list_keys(namespace):
                if key == register_key:
                    continue
                storage.save(
                    namespace, key,
                    _remap_legacy_team_references(storage.load(namespace, key), legacy_team_ids),
                )
        for key in ('teams', 'workforce', 'projects'):
            storage.save('config', key, candidate[key])
        for key in ('people', 'cost_config'):
            if storage.exists('config', key):
                storage.delete('config', key)
        for key in list(storage.list_keys('config')):
            if key.startswith(('people_backup_', 'cost_config_backup_')):
                storage.delete('config', key)
        for key in list(storage.list_keys('cost_cache')):
            storage.delete('cost_cache', key)
        storage.save('system', 'workforce_backend_refresh_required', True)
        return candidate['report']


def validate_workforce_records(storage: StorageBackend) -> None:
    """Verify canonical persisted contracts without rewriting retained unknown allocations."""
    catalogue = TeamCatalogue(storage.load('config', 'teams'))
    WorkforceCatalogue(storage.load('config', 'workforce'), catalogue)
    validate_project_availability(storage.load('config', 'projects'), catalogue.definitions())
    if any(storage.exists('config', key) for key in ('people', 'cost_config')):
        raise ValueError('Canonical workforce cannot retain active person-based configuration')