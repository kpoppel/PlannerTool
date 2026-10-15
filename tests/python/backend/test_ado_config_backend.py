"""Tests for AdoConfigBackend: fetch_ado_config and save_ado_config on ConfigBackend."""
from contextlib import AbstractContextManager, nullcontext
import pytest
from planner_lib.backend.config import ConfigBackend
from planner_lib.storage.base import StorageBackend


class _MemStore(StorageBackend):
    def __init__(self):
        self._data = {}

    def save(self, namespace, key, value, ttl_seconds=None):
        self._data.setdefault(namespace, {})[key] = value

    def load(self, namespace, key):
        try:
            return self._data[namespace][key]
        except KeyError:
            raise KeyError(key)

    def delete(self, namespace, key):
        del self._data[namespace][key]

    def list_keys(self, namespace):
        return list(self._data.get(namespace, {}).keys())

    def exists(self, namespace, key):
        return key in self._data.get(namespace, {})

    def configure(self, **options):
        return None

    def transaction(self) -> AbstractContextManager[None]:
        """Provide the single-threaded fixture's read transaction context."""
        return nullcontext()


def test_fetch_ado_config_missing_returns_empty():
    """fetch_ado_config returns {} when no ado_config has been saved."""
    cb = ConfigBackend(storage=_MemStore())
    assert cb.fetch_ado_config() == {}


def test_fetch_ado_config_returns_stored():
    """fetch_ado_config returns the stored ado_config dict."""
    storage = _MemStore()
    cb = ConfigBackend(storage=storage)
    cfg = {'organization_url': 'MyOrg', 'feature_flags': {'use_azure_mock': True}}
    cb.save_ado_config(cfg)
    result = cb.fetch_ado_config()
    assert result['organization_url'] == 'MyOrg'
    assert result['feature_flags']['use_azure_mock'] is True


def test_save_ado_config_overwrites():
    """save_ado_config overwrites previous value."""
    storage = _MemStore()
    cb = ConfigBackend(storage=storage)
    cb.save_ado_config({'organization_url': 'OldOrg'})
    cb.save_ado_config({'organization_url': 'NewOrg', 'feature_flags': {}})
    assert cb.fetch_ado_config()['organization_url'] == 'NewOrg'


def test_save_config_writes_to_diskcache():
    """save_config writes to the storage under the config namespace."""
    storage = _MemStore()
    cb = ConfigBackend(storage=storage)
    cb.save_config('projects', {'project_map': [{'name': 'P1'}]})
    assert storage.exists('config', 'projects')
    assert storage.load('config', 'projects')['project_map'][0]['name'] == 'P1'


def test_save_config_raw_writes_to_diskcache():
    """save_config_raw writes without backup (same underlying effect)."""
    storage = _MemStore()
    cb = ConfigBackend(storage=storage)
    cb.save_config_raw('area_plan_map', {'proj': {}})
    assert storage.exists('config', 'area_plan_map')


def test_invalidate_cache_returns_ok():
    """invalidate_cache is a no-op that returns a status dict."""
    cb = ConfigBackend(storage=_MemStore())
    result = cb.invalidate_cache()
    assert result['ok'] is True
    assert result['invalidated'] == []


def test_fetch_projects_reads_from_storage():
    """fetch_projects returns projects from diskcache storage."""
    storage = _MemStore()
    storage.save('config', 'projects', {
        'container_types': ['project', 'team'],
        'project_map': [
            {'name': 'Alpha', 'type': 'project', 'area_path': 'Org\\Alpha', 'task_types': ['Feature'], 'iteration_uuid': 'set-alpha'}
        ]
    })
    storage.save('config', 'global_settings', {
        'task_type_hierarchy': [],
        'state_display_sequence': ['New', 'Active', 'Closed'],
    })
    cb = ConfigBackend(storage=storage)
    projects = cb.fetch_projects()
    assert len(projects) == 1
    assert projects[0]['name'] == 'Alpha'
    assert projects[0]['state_display_sequence'] == ['New', 'Active', 'Closed']
    assert projects[0]['iteration_uuid'] == 'set-alpha'


def test_fetch_projects_preserves_custom_container_hierarchy_without_leaf_plans():
    storage = _MemStore()
    storage.save('config', 'projects', {
        'container_types': ['portfolio', 'program', 'squad'],
        'project_map': [{'name': 'Program', 'type': 'program'}],
    })
    projects = ConfigBackend(storage=storage).fetch_projects()
    assert projects[0]['type'] == 'program'
    assert projects[0]['container_order'] == 1
    assert projects[0]['container_types'] == ['portfolio', 'program', 'squad']


def test_fetch_config_teams_reads_from_storage(canonical_team_config):
    """Team choices expose persisted identities and omit archived records."""
    storage = _MemStore()
    storage.save('config', 'teams', canonical_team_config)
    cb = ConfigBackend(storage=storage)
    teams = cb.fetch_config_teams()
    assert [team['id'] for team in teams] == ['team-alpha', 'group-engineering']
    assert teams[0]['name'] == 'Alpha'


@pytest.mark.parametrize('cached', [False, True])
def test_archived_team_resolves_for_existing_allocations(cached: bool, canonical_team_config: dict) -> None:
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.projects.capacity_service import CapacityService
    from planner_lib.repository.team_repository import TeamRepository

    storage = _MemStore()
    storage.save('config', 'teams', canonical_team_config)
    backend = ConfigBackend(storage=storage)
    if cached:
        backend = CachingBackend(backend, storage=_MemStore())
    repository = TeamRepository(backend)
    assert [team['id'] for team in repository.list_teams()] == ['team-alpha', 'group-engineering']
    assert repository.name_to_id(' bet ') == 'team-beta'
    assert repository.id_to_short_name('team-beta') == 'BET'
    service = CapacityService(repository)
    block = service.serialize([{'team': 'team-beta', 'capacity': 25}], cfg={})
    assert service.parse(block) == [{'team': 'BET', 'capacity': 25}]


@pytest.fixture
def canonical_team_config() -> dict:
    return {
        'schema_version': 3,
        'teams': [
            {
                'id': 'team-alpha', 'allocation_token': 'ALP', 'name': 'Alpha',
                'short_name': 'Alpha display', 'archived': False, 'group_id': 'group-engineering',
            },
            {
                'id': 'team-beta', 'allocation_token': 'BET', 'name': 'Beta',
                'short_name': 'Beta display', 'archived': True, 'group_id': None,
            },
        ],
        'groups': [
            {
                'id': 'group-engineering', 'allocation_token': 'ENG', 'name': 'Engineering',
                'short_name': 'Engineering display', 'archived': False,
            },
            {
                'id': 'group-empty', 'allocation_token': 'EMPTY', 'name': 'Empty',
                'short_name': 'Empty display', 'archived': True,
            },
        ],
    }


def test_canonical_catalogue_keeps_archives_out_of_new_choices(canonical_team_config: dict) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    catalogue = TeamCatalogue(canonical_team_config)
    assert [entry['id'] for entry in catalogue.definitions()] == [
        'team-alpha', 'team-beta', 'group-engineering', 'group-empty',
    ]
    assert [entry['id'] for entry in catalogue.allocation_choices()] == [
        'team-alpha', 'group-engineering',
    ]
    assert catalogue.token_to_id(' bet ') == 'team-beta'
    assert catalogue.id_to_token('team-beta') == 'BET'


def test_canonical_catalogue_renames_do_not_change_identity(canonical_team_config: dict) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    canonical_team_config['teams'][0]['name'] = 'Renamed team'
    canonical_team_config['teams'][0]['short_name'] = 'NEW'
    catalogue = TeamCatalogue(canonical_team_config)
    assert catalogue.token_to_id(' alp ') == 'team-alpha'
    assert catalogue.id_to_token('team-alpha') == 'ALP'
    with pytest.raises(ValueError, match='Unknown allocation token'):
        catalogue.token_to_id('NEW')
    with pytest.raises(ValueError, match='Unknown allocation token'):
        catalogue.token_to_id('Renamed team')


def test_canonical_catalogue_group_membership_is_explicit(canonical_team_config: dict) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    catalogue = TeamCatalogue(canonical_team_config)
    assert catalogue.member_team_ids('group-engineering') == ['team-alpha']
    assert catalogue.member_team_ids('group-empty') == []
    assert catalogue.definitions()[2]['kind'] == 'group'
    assert catalogue.definitions()[0]['kind'] == 'team'
    with pytest.raises(ValueError, match='not a group'):
        catalogue.member_team_ids('team-alpha')


def test_canonical_catalogue_archived_group_does_not_archive_members(canonical_team_config: dict) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    canonical_team_config['groups'][0]['archived'] = True
    catalogue = TeamCatalogue(canonical_team_config)
    assert [entry['id'] for entry in catalogue.allocation_choices()] == ['team-alpha']
    assert catalogue.member_team_ids('group-engineering') == ['team-alpha']


@pytest.mark.parametrize('field,value,message', [
    ('id', 'team-beta', 'Duplicate allocation ID'),
    ('allocation_token', ' bet ', 'Duplicate allocation token'),
    ('group_id', 'missing-group', 'Unknown group'),
    ('group_id', 'team-beta', 'Unknown group'),
    ('archived', 'false', 'archived'),
    ('allocation_token', 'bad:token', 'allocation_token'),
    ('allocation_token', '#comment', 'allocation_token'),
    ('allocation_token', 'bad\ntoken', 'allocation_token'),
])
def test_canonical_catalogue_rejects_invalid_team_definitions(
    canonical_team_config: dict, field: str, value: object, message: str,
) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    canonical_team_config['teams'][0][field] = value
    with pytest.raises(ValueError, match=message):
        TeamCatalogue(canonical_team_config)


@pytest.mark.parametrize('field,value,message', [
    ('id', 'team-beta', 'Duplicate allocation ID'),
    ('allocation_token', 'bet', 'Duplicate allocation token'),
    ('group_id', 'group-empty', 'group_id'),
])
def test_canonical_catalogue_validates_groups_in_the_same_namespace(
    canonical_team_config: dict, field: str, value: object, message: str,
) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    canonical_team_config['groups'][0][field] = value
    with pytest.raises(ValueError, match=message):
        TeamCatalogue(canonical_team_config)


def test_canonical_catalogue_does_not_mutate_or_expose_source_records(canonical_team_config: dict) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    catalogue = TeamCatalogue(canonical_team_config)
    canonical_team_config['teams'][0]['allocation_token'] = 'CHANGED'
    catalogue.definitions()[0]['allocation_token'] = 'ALSO CHANGED'
    assert catalogue.id_to_token('team-alpha') == 'ALP'
    assert 'kind' not in canonical_team_config['teams'][0]


def test_canonical_catalogue_reports_unknown_deleted_identity(canonical_team_config: dict) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    catalogue = TeamCatalogue(canonical_team_config)
    with pytest.raises(ValueError, match='Unknown allocation ID'):
        catalogue.id_to_token('deleted-team')
    with pytest.raises(ValueError, match='Unknown allocation token'):
        catalogue.token_to_id('DELETED')


def test_canonical_catalogue_requires_migrated_schema(canonical_team_config: dict) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    canonical_team_config['schema_version'] = 2
    with pytest.raises(ValueError, match='schema_version'):
        TeamCatalogue(canonical_team_config)


def test_canonical_repository_uses_tokens_and_persisted_ids(canonical_team_config: dict) -> None:
    """Renames cannot silently change read/write identity or revive archived choices."""
    from planner_lib.backend.config import WorkforceConfigBackend
    from planner_lib.repository.team_repository import TeamRepository

    storage = _MemStore()
    storage.save('config', 'teams', canonical_team_config)
    repository = TeamRepository(WorkforceConfigBackend(storage))
    assert [team['id'] for team in repository.list_teams()] == ['team-alpha', 'group-engineering']
    assert len(repository.list_teams(include_archived=True)) == 4
    assert repository.name_to_id(' bet ') == 'team-beta'
    assert repository.name_to_id('Beta') is None
    assert repository.name_to_id('Beta display') is None
    assert repository.name_to_id(' eng ') == 'group-engineering'
    assert repository.id_to_short_name('group-empty') == 'EMPTY'
    assert repository.id_to_short_name('deleted') is None
    canonical_team_config['teams'][0]['name'] = 'Renamed'
    canonical_team_config['teams'][0]['short_name'] = 'NEW'
    storage.save('config', 'teams', canonical_team_config)
    assert repository.name_to_id('ALP') == 'team-alpha'
    assert repository.name_to_id('NEW') is None
    assert repository.id_to_short_name('team-alpha') == 'ALP'


def test_canonical_repository_round_trip_preserves_unknown_source_rows(canonical_team_config: dict) -> None:
    """Canonical serialization changes labels neither for archives nor unresolved source rows."""
    from planner_lib.backend.adapter import AzureAdapter
    from planner_lib.backend.config import WorkforceConfigBackend
    from planner_lib.projects.capacity_service import CapacityService
    from planner_lib.repository.team_repository import TeamRepository

    storage = _MemStore()
    storage.save('config', 'teams', canonical_team_config)
    repository = TeamRepository(WorkforceConfigBackend(storage))
    service = CapacityService(repository)
    description = '[PlannerTool Team Capacity]\nBET: 25\nNone: 20\nNone: 20\n[/PlannerTool Team Capacity]'
    task = AzureAdapter().to_domain({'id': 'item', 'description': description}, 'plan', repository, {}, {}, service)
    edited = service.update_description(description, task['capacity'], {})
    assert service.parse(edited) == service.parse(description)
    assert repository.list_teams(include_archived=True)[1]['archived'] is True


def test_canonical_backend_refuses_unmigrated_catalogue() -> None:
    """The canonical runtime port must not fall back to deriving IDs from display names."""
    from planner_lib.backend.config import WorkforceConfigBackend

    storage = _MemStore()
    storage.save('config', 'teams', {'schema_version': 2, 'teams': []})
    with pytest.raises(ValueError, match='Invalid team configuration'):
        WorkforceConfigBackend(storage).fetch_config_teams()


def test_canonical_projects_expose_defaults_and_explicit_empty_override(canonical_team_config: dict) -> None:
    """Bootstrap retains default/override distinctions and validates reference identities."""
    from planner_lib.backend.config import WorkforceConfigBackend

    storage = _MemStore()
    storage.save('config', 'teams', canonical_team_config)
    config = {
        'schema_version': 4, 'container_types': ['Program', 'Plan'],
        'allocation_defaults': {'Program': ['group-engineering'], 'Plan': ['team-alpha']},
        'project_map': [{'name': 'Inherited', 'type': 'Plan'},
                        {'name': 'Empty', 'type': 'Plan', 'allocatable_ids': []}],
    }
    storage.save('config', 'projects', config)
    backend = WorkforceConfigBackend(storage)
    projects = backend.fetch_projects()
    assert projects[0]['allocation_defaults'] == config['allocation_defaults']
    assert 'allocatable_ids' not in projects[0]
    assert projects[1]['allocatable_ids'] == []
    projects[0]['allocation_defaults']['Plan'].clear()
    assert backend.fetch_projects()[0]['allocation_defaults']['Plan'] == ['team-alpha']
    config['project_map'][1]['allocatable_ids'] = ['missing']
    with pytest.raises(ValueError, match='Unknown allocation availability'):
        backend.fetch_projects()
    config['project_map'][1]['allocatable_ids'] = []
    del config['allocation_defaults']['Program']
    with pytest.raises(ValueError, match='container types'):
        backend.fetch_projects()


@pytest.mark.parametrize('config,message', [
    ({}, 'schema_version'),
    ({'schema_version': 3}, 'teams'),
    ({'schema_version': 3, 'teams': []}, 'groups'),
    ({'schema_version': 3, 'teams': {}, 'groups': []}, 'teams'),
    ({'schema_version': 3, 'teams': [], 'groups': {}}, 'groups'),
    ({'schema_version': 3, 'teams': [], 'groups': [], 'people': []}, 'people'),
])
def test_canonical_catalogue_rejects_malformed_config(config: dict, message: str) -> None:
    from planner_lib.domain.teams import TeamCatalogue

    with pytest.raises(ValueError, match=message):
        TeamCatalogue(config)


def test_canonical_catalogue_tokens_round_trip_through_capacity_parser(
    canonical_team_config: dict,
) -> None:
    from planner_lib.domain.teams import TeamCatalogue
    from planner_lib.projects.capacity_service import CapacityService

    canonical_team_config['teams'][0]['allocation_token'] = 'R&D'
    catalogue = TeamCatalogue(canonical_team_config)
    identities = ['team-alpha', 'team-beta', 'group-engineering', 'group-empty']
    lines = ['[PlannerTool Team Capacity]']
    lines.extend(f'{catalogue.id_to_token(identity)}: 25' for identity in identities)
    lines.append('[/PlannerTool Team Capacity]')
    parsed = CapacityService(catalogue).parse('\n'.join(lines))
    assert [catalogue.token_to_id(entry['team']) for entry in parsed] == identities
    assert [entry['capacity'] for entry in parsed] == [25, 25, 25, 25]
