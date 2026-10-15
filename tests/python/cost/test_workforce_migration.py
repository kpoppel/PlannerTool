"""Revision-35 workforce conversion and canonical startup contracts."""
from itertools import count
from copy import deepcopy
from collections.abc import Iterator
from pathlib import Path

import pytest

from planner_lib.domain.teams import TeamCatalogue
from planner_lib.domain.workforce import WorkforceCatalogue
from planner_lib.migrations.workforce_candidate import build_workforce_candidate
from planner_lib.storage.base import StorageBackend
from planner_lib.storage.diskcache_backend import DiskCacheStorage


@pytest.fixture
def candidate_storage(tmp_path: Path) -> Iterator[StorageBackend]:
    """Use the real transaction port for candidate upgrade and rollback evidence."""
    storage = DiskCacheStorage(tmp_path / 'candidate')
    try:
        yield storage
    finally:
        storage.close()


def legacy_fixture() -> dict:
    """Provide known, archived, unconfigured and missing-team staffing with distinct rates."""
    return {
        'teams': {'schema_version': 2, 'teams': [
            {'name': 'Alpha', 'short_name': 'ALPHA', 'exclude': False},
            {'name': 'Beta', 'short_name': 'BETA', 'exclude': True},
        ]},
        'people': {'database': {'people': [
            {'name': 'Person One', 'team_name': 'Alpha', 'site': 'Site A', 'external': False},
            {'name': 'Person Two', 'team_name': 'Alpha', 'site': 'Site A', 'external': False},
            {'name': 'Person Three', 'team_name': 'Beta', 'site': 'Site A', 'external': False},
            {'name': 'Person Four', 'team_name': 'Unconfigured', 'site': 'Site A', 'external': True},
            {'name': 'Person Five', 'team_name': '', 'site': 'Site A', 'external': True},
        ]}},
        'cost': {'working_hours': {'Site A': {'internal': 116, 'external': 160}},
                 'internal_cost': {'default_hourly_rate': 64},
                 'external_cost': {'default_hourly_rate': 50,
                                   'external': {'Person Four': 75}}},
        'projects': {'schema_version': 3, 'container_types': ['Program', 'Plan'],
                     'project_map': [{'name': 'Project', 'type': 'Plan', 'area_path': 'Area'}]},
    }


def test_candidate_archives_incomplete_items_and_preserves_anonymous_basis() -> None:
    """Unknown staffing is retained for admin review, not silently assigned or discarded."""
    source = legacy_fixture()
    original = deepcopy(source)
    identities = count()
    candidate = build_workforce_candidate(
        source['teams'], source['people'], source['cost'], source['projects'],
        id_issuer=lambda: f'issued-{next(identities)}',
    )
    teams = TeamCatalogue(candidate['teams'])
    workforce = WorkforceCatalogue(candidate['workforce'], teams)
    definitions = {record['id']: record for record in teams.definitions()}
    assert definitions['team-alpha']['allocation_token'] == 'ALPHA'
    assert definitions['team-beta']['archived'] is True
    for identity in ['team-unconfigured', 'team-']:
        assert definitions[identity]['migration_incomplete'] is True
        assert definitions[identity]['archived'] is True
    expected = {
        'team-alpha': {'internal': (2, 232, 14848), 'external': (0, 0, 0)},
        'team-beta': {'internal': (1, 116, 7424), 'external': (0, 0, 0)},
        'team-unconfigured': {'internal': (0, 0, 0), 'external': (1, 160, 12000)},
        'team-': {'internal': (0, 0, 0), 'external': (1, 160, 8000)},
    }
    bases = workforce.team_bases()
    assert set(bases) == set(expected)
    for identity, accounts in expected.items():
        for account in ('internal', 'external'):
            fte, hours, cost = accounts[account]
            assert bases[identity][account] == {
                'fte': fte, 'monthly_hours': hours, 'monthly_cost': cost,
            }
    assert candidate['projects']['schema_version'] == 4
    assert candidate['projects']['allocation_defaults'] == {
        'Program': ['team-alpha'], 'Plan': ['team-alpha'],
    }
    assert candidate['report']['staffing_fte'] == 5
    assert candidate['report']['incomplete_team_ids'] == ['team-', 'team-unconfigured']
    assert 'Person' not in str(candidate)
    assert source == original
    assert all('last_updated' not in record for record in teams.definitions())


def test_candidate_rejects_collision_instead_of_renaming_ado_tokens() -> None:
    """Legacy token uniqueness remains a preflight gate across archived definitions."""
    source = legacy_fixture()
    source['teams']['teams'][1]['short_name'] = ' alpha '
    with pytest.raises(ValueError, match='token'):
        build_workforce_candidate(source['teams'], source['people'], source['cost'], source['projects'])


def test_candidate_reserves_every_legacy_staffing_team_before_issuing_identities() -> None:
    """Early supplier issuance cannot consume a later unmatched legacy team identity."""
    source = legacy_fixture()
    identities = iter(['team-unconfigured', 'team-', *[f'issued-{index}' for index in range(20)]])
    candidate = build_workforce_candidate(
        source['teams'], source['people'], source['cost'], source['projects'],
        id_issuer=lambda: next(identities),
    )
    team_ids = {record['id'] for record in candidate['teams']['teams']}
    issued = [supplier['id'] for supplier in candidate['workforce']['suppliers']]
    issued.extend(profile['id'] for supplier in candidate['workforce']['suppliers']
                  for profile in supplier['profiles'])
    issued.extend(record['id'] for record in candidate['workforce']['staffing'])
    assert not team_ids.intersection(issued)
    assert len(issued) == len(set(issued))


def test_candidate_store_upgrade_is_atomic_and_preserves_retained_records(
    candidate_storage: StorageBackend,
) -> None:
    """The isolated upgrade retires active person data without rewriting local task references."""
    from planner_lib.migrations.workforce_candidate import upgrade_workforce_candidate

    cache_storage = candidate_storage
    source = legacy_fixture()
    for key in ('teams', 'people', 'projects'):
        cache_storage.save('config', key, source[key])
    cache_storage.save('config', 'cost_config', source['cost'])
    retained = {'overrides': {'task': {'capacity': [
        {'team': 'team-alpha', 'capacity': 50}, {'team': 'None', 'capacity': 20},
        {'team': 'None', 'capacity': 20},
    ]}}}
    cache_storage.save('scenarios', 'fixture', retained)
    cache_storage.save('config', 'people_backup_fixture', source['people'])
    cache_storage.save('config', 'cost_config_backup_fixture', source['cost'])
    cache_storage.save('cost_cache', 'team_rates', {'obsolete_person_data': True})
    report = upgrade_workforce_candidate(cache_storage)
    assert report['staffing_fte'] == 5
    assert cache_storage.load('config', 'teams')['schema_version'] == 3
    assert cache_storage.load('config', 'workforce')['schema_version'] == 2
    assert cache_storage.load('config', 'projects')['schema_version'] == 4
    assert not cache_storage.exists('config', 'people')
    assert not cache_storage.exists('config', 'cost_config')
    assert not cache_storage.exists('config', 'people_backup_fixture')
    assert not cache_storage.exists('config', 'cost_config_backup_fixture')
    assert list(cache_storage.list_keys('cost_cache')) == []
    assert cache_storage.load('scenarios', 'fixture') == retained


def test_candidate_store_upgrade_rolls_back_a_failed_persist(
    candidate_storage: StorageBackend, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A rejected candidate cannot publish one half of the coordinated schema conversion."""
    from planner_lib.migrations.workforce_candidate import upgrade_workforce_candidate

    cache_storage = candidate_storage
    source = legacy_fixture()
    for key in ('teams', 'people', 'projects'):
        cache_storage.save('config', key, source[key])
    cache_storage.save('config', 'cost_config', source['cost'])
    save = cache_storage.save

    def fail(namespace: str, key: str, content: object, **kwargs: object) -> None:
        if namespace == 'config' and key == 'workforce':
            raise OSError('fixture candidate failure')
        save(namespace, key, content, **kwargs)

    monkeypatch.setattr(cache_storage, 'save', fail)
    with pytest.raises(OSError, match='fixture candidate failure'):
        upgrade_workforce_candidate(cache_storage)
    assert cache_storage.load('config', 'teams') == source['teams']
    assert cache_storage.load('config', 'people') == source['people']
    assert cache_storage.load('config', 'projects') == source['projects']
    assert cache_storage.load('config', 'cost_config') == source['cost']
    assert not cache_storage.exists('config', 'workforce')


def test_canonical_runtime_registration_uses_only_migrated_workforce_owners(
    candidate_storage: StorageBackend,
) -> None:
    """One explicit composition selects token identity, strict publication and anonymous cost."""
    from unittest.mock import Mock
    from planner_lib.admin.workforce_service import WorkforceAdminService
    from planner_lib.backend.config import WorkforceConfigBackend
    from planner_lib.cost.service import WorkforceCostService
    from planner_lib.migrations.workforce_candidate import upgrade_workforce_candidate
    from planner_lib.repository.task_repository import WorkforceTaskRepository
    from planner_lib.repository.team_repository import TeamRepository
    from planner_lib.services.container import ServiceContainer
    from planner_lib.services.workforce_runtime import register_workforce_runtime

    source = legacy_fixture()
    for key in ('teams', 'people', 'projects'):
        candidate_storage.save('config', key, source[key])
    candidate_storage.save('config', 'cost_config', source['cost'])
    upgrade_workforce_candidate(candidate_storage)
    container = ServiceContainer()
    for key in ('project_repository', 'backend', 'credential_provider', 'account_manager', 'azure_client'):
        container.register_factory(key, Mock)
    container.register_singleton('storage', candidate_storage)
    container.register_singleton('remote_cache_storage', candidate_storage)
    register_workforce_runtime(container)
    assert isinstance(container.get('config_backend'), WorkforceConfigBackend)
    assert isinstance(container.get('team_repository'), TeamRepository)
    assert isinstance(container.get('task_repository'), WorkforceTaskRepository)
    assert isinstance(container.get('cost_service'), WorkforceCostService)
    assert isinstance(container.get('admin_service'), WorkforceAdminService)
    teams = container.get('team_repository')
    assert teams.name_to_id('ALPHA') == 'team-alpha'
    assert teams.id_to_short_name('team-alpha') == 'ALPHA'
    assert container.get('cost_service').team_bases()['teams']['team-alpha']['internal']['fte'] == 2


def test_workforce_cutover_refreshes_only_normalized_backend_cache_once(
    candidate_storage: StorageBackend,
) -> None:
    """Old normalized snapshots cannot hide unknown rows; raw sources and user data survive."""
    from planner_lib.services.container import ServiceContainer
    from planner_lib.services.workforce_runtime import refresh_workforce_backend_cache

    candidate_storage.save('system', 'workforce_backend_refresh_required', True)
    candidate_storage.save('backend_domain', 'fetch_plan_tasks__old', [{'id': 'old'}])
    candidate_storage.save('azure_cache', 'raw', {'source': 'unchanged'})
    candidate_storage.save('scenarios', 'saved', {'overrides': {}})
    container = ServiceContainer()
    container.register_singleton('storage', candidate_storage)
    container.register_singleton('remote_cache_storage', candidate_storage)
    refresh_workforce_backend_cache(container)
    assert list(candidate_storage.list_keys('backend_domain')) == []
    assert candidate_storage.load('azure_cache', 'raw') == {'source': 'unchanged'}
    assert candidate_storage.load('scenarios', 'saved') == {'overrides': {}}
    assert candidate_storage.load('system', 'workforce_backend_refresh_required') is False
    candidate_storage.save('backend_domain', 'fresh', [{'id': 'new'}])
    refresh_workforce_backend_cache(container)
    assert candidate_storage.load('backend_domain', 'fresh') == [{'id': 'new'}]