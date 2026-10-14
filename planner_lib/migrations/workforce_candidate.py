"""Pure workforce conversion and coordinator-owned revision-35 candidate upgrade."""
from collections.abc import Callable, Mapping
from copy import deepcopy
from math import isfinite
from typing import Any

from planner_lib.admin.workforce_config import _timestamp_identity
from planner_lib.domain.allocation_availability import validate_project_availability
from planner_lib.domain.teams import TeamCatalogue
from planner_lib.domain.workforce import WorkforceCatalogue
from planner_lib.storage.base import StorageBackend
from planner_lib.util import slugify


def _quantity(value: Any, context: str) -> float:
    quantity = float(value)
    if isinstance(value, bool) or not isfinite(quantity) or quantity < 0:
        raise ValueError(f'Invalid legacy workforce quantity: {context}')
    return quantity


def _staffing_team_id(person: Mapping[str, Any]) -> str:
    raw_team = person.get('team_name') or person.get('team') or ''
    base = slugify(raw_team)
    return base if base.startswith('team-') else f'team-{base}'


def build_workforce_candidate(
    teams_config: Mapping[str, Any], people_config: Mapping[str, Any],
    cost_config: Mapping[str, Any], projects_config: Mapping[str, Any],
    *, id_issuer: Callable[[], str] = _timestamp_identity,
) -> dict[str, Any]:
    """Preserve observed anonymous bases, retaining unmatched staffing as archived review items."""
    if teams_config['schema_version'] != 2 or projects_config['schema_version'] != 3:
        raise ValueError('Workforce conversion requires teams v2 and projects v3')
    definitions = []
    for team in teams_config['teams']:
        definitions.append({
            'id': slugify(team['name'], prefix='team-'),
            'allocation_token': team['short_name'], 'name': team['name'],
            'short_name': team['short_name'], 'archived': bool(team.get('exclude', False)),
            'group_id': None,
        })
    team_configuration = {'schema_version': 3, 'teams': definitions, 'groups': []}
    initial = TeamCatalogue(team_configuration)
    available = [team['id'] for team in initial.allocation_choices()]
    by_id = {team['id']: team for team in definitions}
    used = {value for team in definitions for value in (team['id'], team['allocation_token'].strip().lower())}
    records = people_config['database']['people']
    for person in records:
        identity = _staffing_team_id(person)
        used.update((identity, identity.lower()))

    def issue() -> str:
        while True:
            identity = id_issuer()
            if not isinstance(identity, str) or not identity.strip() or identity != identity.strip():
                raise ValueError('Migration identity issuer must return a nonempty opaque ID')
            if identity not in used and identity.lower() not in used:
                used.add(identity)
                used.add(identity.lower())
                return identity

    suppliers: dict[tuple[str, bool], dict[str, Any]] = {}
    profiles: dict[tuple[str, float, float], dict[str, Any]] = {}
    staffing: dict[tuple[str, str, str], dict[str, Any]] = {}
    for person in records:
        raw_team = person.get('team_name') or person.get('team') or ''
        identity = _staffing_team_id(person)
        if identity not in by_id:
            label = raw_team.strip() if raw_team.strip() else 'Unassigned staffing'
            record = {
                'id': identity, 'allocation_token': identity, 'name': label,
                'short_name': label, 'archived': True, 'group_id': None,
                'migration_incomplete': True,
            }
            by_id[identity] = record
            definitions.append(record)
            used.add(identity)
            used.add(identity.lower())
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
        catalogue = TeamCatalogue(candidate['teams'])
        WorkforceCatalogue(candidate['workforce'], catalogue)
        validate_project_availability(candidate['projects'], catalogue.definitions())
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