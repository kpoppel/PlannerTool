"""Contracts for anonymous workforce inputs before runtime migration activation."""
from copy import deepcopy
from pathlib import Path
from typing import Any
from types import SimpleNamespace

import pytest

from planner_lib.cost import engine
from planner_lib.cost.service import WorkforceCostService
from planner_lib.domain.teams import TeamCatalogue
from planner_lib.domain.workforce import WorkforceCatalogue
from planner_lib.storage.diskcache_backend import DiskCacheStorage


@pytest.fixture
def teams() -> TeamCatalogue:
    """Return persisted team identities, including archived and empty definitions."""
    return TeamCatalogue({
        'schema_version': 3,
        'teams': [
            {'id': 'team-one', 'allocation_token': 'ONE', 'name': 'One',
             'short_name': 'One', 'archived': False, 'group_id': 'group-one'},
            {'id': 'team-old', 'allocation_token': 'OLD', 'name': 'Old',
             'short_name': 'Old', 'archived': True, 'group_id': 'group-one'},
            {'id': 'team-empty', 'allocation_token': 'EMPTY', 'name': 'Empty',
             'short_name': 'Empty', 'archived': False, 'group_id': None},
        ],
        'groups': [
            {'id': 'group-one', 'allocation_token': 'GROUP', 'name': 'Group',
             'short_name': 'Group', 'archived': True},
            {'id': 'group-empty', 'allocation_token': 'EMPTY-GROUP', 'name': 'Empty group',
             'short_name': 'Empty group', 'archived': False},
        ],
    })


@pytest.fixture
def workforce_config() -> dict:
    """Return fractional staffing with repeated profiles and mixed accounting bases."""
    return {
        'schema_version': 2,
        'suppliers': [
            {'id': 'internal', 'name': 'Internal provider', 'external': False,
             'archived': False, 'profiles': [
                 {'id': 'standard', 'name': 'Standard', 'monthly_project_hours': 160,
                  'hourly_rate': 50, 'archived': False},
                 {'id': 'reduced', 'name': 'Reduced', 'monthly_project_hours': 120,
                  'hourly_rate': 70, 'archived': True},
             ]},
            {'id': 'external', 'name': 'External supplier', 'external': True,
             'archived': True, 'profiles': [
                 {'id': 'standard', 'name': 'Standard', 'monthly_project_hours': 80,
                  'hourly_rate': 150, 'archived': False},
             ]},
        ],
        'staffing': [
            {'id': 'row-one', 'team_id': 'team-one', 'supplier_id': 'internal',
             'profile_id': 'standard', 'fte': 0.5},
            {'id': 'row-two', 'team_id': 'team-one', 'supplier_id': 'internal',
             'profile_id': 'standard', 'fte': 0.25},
            {'id': 'row-three', 'team_id': 'team-one', 'supplier_id': 'internal',
             'profile_id': 'reduced', 'fte': 0.5},
            {'id': 'row-four', 'team_id': 'team-one', 'supplier_id': 'external',
             'profile_id': 'standard', 'fte': 1.25},
            {'id': 'row-old', 'team_id': 'team-old', 'supplier_id': 'internal',
             'profile_id': 'standard', 'fte': 1},
        ],
    }


def test_fractional_fte_and_mixed_profiles_preserve_separate_accounts(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Aggregate each hours/rate product, not products of aggregated rates and hours."""
    bases = WorkforceCatalogue(workforce_config, teams).team_bases()
    assert set(bases) == {'team-one', 'team-old', 'team-empty'}
    assert bases['team-one']['internal'] == {
        'fte': 1.25, 'monthly_hours': 180, 'monthly_cost': 10200,
    }
    assert bases['team-one']['external'] == {
        'fte': 1.25, 'monthly_hours': 100, 'monthly_cost': 15000,
    }
    assert bases['team-empty']['internal'] == {
        'fte': 0, 'monthly_hours': 0, 'monthly_cost': 0,
    }
    profiles = bases['team-one']['profiles']
    assert len(profiles) == 3
    assert profiles[0] == {
        'supplier_id': 'internal', 'profile_id': 'standard', 'external': False,
        'fte': 0.75, 'monthly_hours': 120, 'monthly_cost': 6000,
    }
    assert 'monthly_cost' not in bases['team-one']


def test_archives_preserve_basis_but_are_not_new_supplier_choices(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Archiving suppliers/profiles/teams/groups retains their historical calculation basis."""
    catalogue = WorkforceCatalogue(workforce_config, teams)
    assert catalogue.team_bases()['team-old']['internal']['monthly_cost'] == 8000
    choices = catalogue.supplier_choices()
    assert [supplier['id'] for supplier in choices] == ['internal']
    assert [profile['id'] for profile in choices[0]['profiles']] == ['standard']
    rollups = catalogue.group_bases()
    assert rollups['group-one']['internal']['monthly_cost'] == 18200
    assert rollups['group-one']['external']['monthly_cost'] == 15000
    assert rollups['group-empty']['internal']['fte'] == 0
    assert 'group-one' not in catalogue.team_bases()


def test_canonical_pricing_uses_fractional_anonymous_bases_and_separate_posts(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Price archived reusable profiles directly without fabricating people or legacy rates."""
    workforce = WorkforceCatalogue(workforce_config, teams)
    priced = engine.calculate_workforce_detailed(
        teams, workforce, '2025-01-06', '2025-01-10', [{'team': 'team-one', 'capacity': 40}],
    )
    basis = workforce.team_bases()['team-one']
    for account in ('internal', 'external'):
        hours = engine._allocate_months('2025-01-06', '2025-01-10', basis[account]['monthly_hours'])
        assert priced[f'{account}_hours'] == round(hours['2025-01'] * 0.4, 2)
        assert priced[f'{account}_cost'] == round(
            basis[account]['monthly_cost'] * hours['2025-01'] / basis[account]['monthly_hours'] * 0.4, 2,
        )
    assert priced['complete'] is True
    profiles = priced['teams']['team-one']['profiles']
    assert {(item['supplier_id'], item['profile_id']) for item in profiles} == {
        ('internal', 'standard'), ('internal', 'reduced'), ('external', 'standard'),
    }
    assert 'totalCost' not in priced['teams']['team-one']


def test_canonical_group_pricing_never_duplicates_member_staffing(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """A group is the full percentage of every archived or active member basis."""
    workforce = WorkforceCatalogue(workforce_config, teams)
    group = engine.calculate_workforce_detailed(
        teams, workforce, '2025-01-06', '2025-01-10', [{'team': 'group-one', 'capacity': 40}],
    )
    members = engine.calculate_workforce_detailed(
        teams, workforce, '2025-01-06', '2025-01-10',
        [{'team': 'team-one', 'capacity': 40}, {'team': 'team-old', 'capacity': 40}],
    )
    assert group == members
    assert set(group['teams']) == {'team-one', 'team-old'}


def test_missing_basis_is_incomplete_but_known_empty_teams_and_groups_are_zero(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Deletion cannot silently turn unknown identity into a complete zero-cost estimate."""
    priced = engine.calculate_workforce_detailed(
        teams, WorkforceCatalogue(workforce_config, teams), '2025-01-06', '2025-01-10',
        [{'team': 'team-empty', 'capacity': 40}, {'team': 'group-empty', 'capacity': 40},
         {'team': 'deleted', 'capacity': 20}],
    )
    assert priced['complete'] is False
    assert priced['missing_basis'] == [{'team': 'deleted', 'capacity': 20}]
    assert priced['internal_cost'] == priced['external_cost'] == 0
    assert 'team-empty' in priced['teams']


def test_fractional_monthly_hours_are_not_truncated_in_canonical_pricing(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Sub-one monthly-hour staffing retains a positive and linearly priced basis."""
    workforce_config['staffing'] = [dict(workforce_config['staffing'][0], fte=0.001)]
    priced = engine.calculate_workforce_detailed(
        teams, WorkforceCatalogue(workforce_config, teams), '2025-01-06', '2025-01-10',
        [{'team': 'team-one', 'capacity': 100}],
    )
    assert priced['internal_hours'] == 0.04
    assert priced['internal_cost'] == 2


def test_canonical_cost_service_resolves_groups_and_reports_incomplete_totals(
    teams: TeamCatalogue, workforce_config: dict, tmp_path: Path,
) -> None:
    """Runtime pricing resolves the full graph before plan projection and preserves missing basis."""
    definitions = teams.definitions()
    configuration = {'schema_version': 3, 'teams': [], 'groups': []}
    for definition in definitions:
        record = dict(definition)
        kind = record.pop('kind')
        configuration['teams' if kind == 'team' else 'groups'].append(record)
    storage = DiskCacheStorage(tmp_path / 'canonical-cost')
    try:
        storage.save('config', 'teams', configuration)
        storage.save('config', 'workforce', workforce_config)
        plans = SimpleNamespace(list_projects=lambda: [
            {'id': 'plan', 'type': 'Plan', 'container_order': 0},
        ])
        service = WorkforceCostService(storage, plans)
        metadata = service.team_bases()
        assert metadata['suppliers'] == workforce_config['suppliers']
        assert {entry['id'] for entry in metadata['catalogue']} == {entry['id'] for entry in definitions}
        assert 'team-one' in metadata['teams'] and 'group-one' in metadata['groups']
        root = {'id': 'root', 'project': 'plan', 'start': '2025-01-06', 'end': '2025-01-10',
                'capacity': [{'team': 'group-one', 'capacity': 40}]}
        leaf = {'id': 'leaf', 'project': 'context', 'sourcePlanIds': ['plan'], 'parentId': 'root',
                'start': '2025-01-06', 'end': '2025-01-10',
                'capacity': [{'team': 'team-one', 'capacity': 100}, {'team': 'deleted', 'capacity': 20}]}
        result = service.estimate_costs({'features': [root, leaf]})
        project = result['projects']['plan']
        assert project['root']['effective_capacity'] == []
        assert project['root']['internal_cost'] == 0
        assert set(project['leaf']['teams']) == {'team-one'}
        assert project['leaf']['complete'] is False
        assert project['totals']['complete'] is False
        assert project['totals']['internal']['cost'] == {'2025-01': project['leaf']['internal_cost']}
        assert result['unknown_teams'] == [{'feature_id': 'leaf', 'team': 'deleted', 'capacity': 20}]
        assert result['complete'] is False
        storage.save('config', 'people', {'invalid': 'must never be read'})
        storage.save('config', 'cost_config', {'invalid': 'must never supply workforce rates'})
        assert service.estimate_costs({'features': [root, leaf]}) == result
    finally:
        storage.close()


def test_workforce_snapshots_have_no_mutable_aliases(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Input records and returned definitions/choices/bases cannot mutate the catalogue."""
    catalogue = WorkforceCatalogue(workforce_config, teams)
    workforce_config['staffing'][0]['fte'] = 99
    workforce_config['suppliers'][0]['profiles'][0]['hourly_rate'] = 999
    catalogue.definitions()['staffing'][0]['fte'] = 999
    catalogue.supplier_choices()[0]['profiles'][0]['hourly_rate'] = 999
    catalogue.team_bases()['team-one']['internal']['monthly_cost'] = 999
    assert catalogue.team_bases()['team-one']['internal']['monthly_cost'] == 10200


@pytest.mark.parametrize('field,value', [
    ('fte', -1), ('fte', True), ('fte', '1'), ('fte', float('nan')),
    ('fte', float('inf')), ('monthly_project_hours', -1),
    ('monthly_project_hours', False), ('monthly_project_hours', float('inf')),
    ('hourly_rate', -1), ('hourly_rate', '50'), ('hourly_rate', float('nan')),
])
def test_invalid_numeric_inputs_are_rejected(
    teams: TeamCatalogue, workforce_config: dict, field: str, value: object,
) -> None:
    """Reject negative, nonnumeric, boolean and nonfinite workforce quantities."""
    record = workforce_config['staffing'][0] if field == 'fte' else (
        workforce_config['suppliers'][0]['profiles'][0]
    )
    record[field] = value
    with pytest.raises(ValueError, match=field):
        WorkforceCatalogue(workforce_config, teams)


@pytest.mark.parametrize('field,value,message', [
    ('team_id', 'missing', 'Unknown team'),
    ('team_id', 'group-one', 'not a team'),
    ('supplier_id', 'missing', 'Unknown supplier'),
    ('profile_id', 'missing', 'Unknown profile'),
    ('id', ' row-one ', 'id'),
    ('name', 'Person name', 'unexpected'),
    ('site', 'Independent site', 'unexpected'),
    ('group_id', 'group-one', 'unexpected'),
])
def test_invalid_staffing_references_and_legacy_fields_are_rejected(
    teams: TeamCatalogue, workforce_config: dict, field: str, value: str, message: str,
) -> None:
    """Workforce references are explicit team/supplier/profile IDs, never people or groups."""
    workforce_config['staffing'][0][field] = value
    with pytest.raises(ValueError, match=message):
        WorkforceCatalogue(workforce_config, teams)


@pytest.mark.parametrize('mutation,message', [
    ('schema', 'schema_version'), ('missing', 'missing'), ('extra', 'unexpected'),
    ('suppliers_type', 'suppliers'), ('staffing_type', 'staffing'),
    ('profiles_type', 'profiles'), ('supplier_duplicate', 'Duplicate supplier'),
    ('profile_duplicate', 'Duplicate profile'), ('staffing_duplicate', 'Duplicate staffing'),
    ('supplier_external', 'external'), ('profile_archived', 'archived'),
])
def test_workforce_candidate_has_strict_schema_and_unique_identities(
    teams: TeamCatalogue, workforce_config: dict, mutation: str, message: str,
) -> None:
    """Profile IDs are supplier-scoped; other identities are unique in their collection."""
    if mutation == 'schema':
        workforce_config['schema_version'] = True
    elif mutation == 'missing':
        del workforce_config['staffing']
    elif mutation == 'extra':
        workforce_config['people'] = []
    elif mutation == 'suppliers_type':
        workforce_config['suppliers'] = {}
    elif mutation == 'staffing_type':
        workforce_config['staffing'] = None
    elif mutation == 'profiles_type':
        workforce_config['suppliers'][0]['profiles'] = {}
    elif mutation == 'supplier_duplicate':
        workforce_config['suppliers'].append(deepcopy(workforce_config['suppliers'][0]))
    elif mutation == 'profile_duplicate':
        profiles = workforce_config['suppliers'][0]['profiles']
        profiles.append(deepcopy(profiles[0]))
    elif mutation == 'staffing_duplicate':
        workforce_config['staffing'].append(deepcopy(workforce_config['staffing'][0]))
    elif mutation == 'supplier_external':
        workforce_config['suppliers'][0]['external'] = 'false'
    elif mutation == 'profile_archived':
        workforce_config['suppliers'][0]['profiles'][0]['archived'] = 1
    with pytest.raises(ValueError, match=message):
        WorkforceCatalogue(workforce_config, teams)


def test_zero_inputs_and_team_rounding_boundary(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Round accumulated monthly costs only after combining rows for the team basis."""
    workforce_config['suppliers'][0]['profiles'][0].update(
        monthly_project_hours=1, hourly_rate=0.006,
    )
    workforce_config['staffing'] = workforce_config['staffing'][:2]
    for row in workforce_config['staffing']:
        row['fte'] = 1
    catalogue = WorkforceCatalogue(workforce_config, teams)
    assert catalogue.team_bases()['team-one']['internal']['monthly_cost'] == 0.01
    workforce_config['staffing'][0]['fte'] = 0
    workforce_config['suppliers'][0]['profiles'][0]['monthly_project_hours'] = 0
    assert WorkforceCatalogue(workforce_config, teams).team_bases()['team-one']['internal'] == {
        'fte': 1, 'monthly_hours': 0, 'monthly_cost': 0,
    }


def test_nonfinite_computed_basis_is_rejected(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Finite source fields cannot produce infinite aggregate hours or costs."""
    workforce_config['staffing'][0]['fte'] = 1e308
    with pytest.raises(ValueError, match='non-finite'):
        WorkforceCatalogue(workforce_config, teams).team_bases()


def test_existing_archived_staffing_can_be_retained_and_edited(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Adjusting FTE does not turn an existing archived reference into a new assignment."""
    previous = WorkforceCatalogue(workforce_config, teams)
    for row in workforce_config['staffing']:
        row['fte'] += 0.25
    candidate = WorkforceCatalogue(workforce_config, teams)
    candidate.validate_staffing_changes(previous)


@pytest.mark.parametrize('field,value,message', [
    ('team_id', 'team-old', 'archived team'),
    ('supplier_id', 'external', 'archived supplier'),
    ('profile_id', 'reduced', 'archived profile'),
])
@pytest.mark.parametrize('new_row', [False, True])
def test_new_archived_assignments_are_rejected(
    teams: TeamCatalogue, workforce_config: dict,
    field: str, value: str, message: str, new_row: bool,
) -> None:
    """Reject both new rows and reference changes on an existing row."""
    previous = WorkforceCatalogue(workforce_config, teams)
    if new_row:
        row = deepcopy(workforce_config['staffing'][0])
        row['id'] = 'new-row'
        workforce_config['staffing'].append(row)
    else:
        row = workforce_config['staffing'][0]
    row[field] = value
    candidate = WorkforceCatalogue(workforce_config, teams)
    with pytest.raises(ValueError, match=message):
        candidate.validate_staffing_changes(previous)


def test_removed_archived_assignment_cannot_be_readded_with_new_row_identity(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Retaining a reference requires retaining the specific staffing row identity."""
    previous = WorkforceCatalogue(workforce_config, teams)
    workforce_config['staffing'][2]['id'] = 'replacement-row'
    candidate = WorkforceCatalogue(workforce_config, teams)
    with pytest.raises(ValueError, match='archived profile'):
        candidate.validate_staffing_changes(previous)


def test_active_assignments_and_removal_of_archived_rows_are_allowed(
    teams: TeamCatalogue, workforce_config: dict,
) -> None:
    """Archive protection does not block intentional row removal or active new choices."""
    previous = WorkforceCatalogue(workforce_config, teams)
    workforce_config['staffing'] = [deepcopy(workforce_config['staffing'][0])]
    workforce_config['staffing'][0].update(id='new-row', team_id='team-empty')
    WorkforceCatalogue(workforce_config, teams).validate_staffing_changes(previous)
