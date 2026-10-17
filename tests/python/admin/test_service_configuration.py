"""Contracts for current admin schemas and area mapping services.

Covers:
- schema.get_schema / get_schema deep copy / catalogue-owned plan fields
- area_mapping_service._merge_plans / refresh_single / refresh_all
"""
import copy
import pytest
from unittest.mock import MagicMock, call, patch


# ===========================================================================
# schema
# ===========================================================================

class TestAdminSchema:
    def setup_method(self):
        from planner_lib.admin import schema as _s
        self.schema = _s

    def test_get_schema_known_types(self):
        for type_name in ('system', 'projects', 'area_mappings'):
            result = self.schema.get_schema(type_name)
            assert isinstance(result, dict), f"Expected dict for {type_name}"
            assert result.get('type') == 'object'

    def test_get_schema_unknown_returns_none(self):
        assert self.schema.get_schema('nonexistent') is None
        assert self.schema.get_schema('') is None
        for removed in ('teams', 'people', 'cost'):
            assert self.schema.get_schema(removed) is None

    def test_get_schema_returns_deep_copy(self):
        s1 = self.schema.get_schema('system')
        s1['_mutation'] = 'injected'
        s2 = self.schema.get_schema('system')
        assert '_mutation' not in s2, "Mutation leaked into the registry"

    def test_projects_schema_requires_explicit_type_selection(self):
        schema = self.schema.get_schema('projects')
        project_items = schema['properties']['project_map']['items']['properties']
        assert project_items['task_types']['minItems'] == 1
        assert 'default' not in project_items['task_types']
        assert 'enum' not in project_items['task_types']['items']

    def test_projects_schema_does_not_expose_retired_state_filters(self):
        schema = self.schema.get_schema('projects')
        entry = schema['properties']['project_map']['items']
        assert entry['additionalProperties'] is False
        assert 'include_states' not in entry['properties']
        assert 'display_states' not in entry['properties']
        assert entry['properties']['closed_history_days']['minimum'] == 0


# ===========================================================================
# area_mapping_service
# ===========================================================================

class TestMergePlans:
    def test_new_plan_defaults_to_enabled(self):
        from planner_lib.admin.area_mapping_service import _merge_plans
        result = _merge_plans({'plan-1': 'Sprint 1'}, {})
        assert result['plan-1'] == {'name': 'Sprint 1', 'enabled': True}

    def test_existing_enabled_flag_preserved(self):
        from planner_lib.admin.area_mapping_service import _merge_plans
        old = {'plan-1': {'name': 'Old', 'enabled': False}}
        result = _merge_plans({'plan-1': 'Sprint 1'}, old)
        assert result['plan-1']['enabled'] is False

    def test_plans_not_in_new_are_dropped(self):
        from planner_lib.admin.area_mapping_service import _merge_plans
        old = {'plan-old': {'name': 'Old', 'enabled': True}}
        result = _merge_plans({'plan-new': 'Sprint 2'}, old)
        assert 'plan-old' not in result
        assert 'plan-new' in result

    def test_old_plans_not_dict_treated_as_empty(self):
        from planner_lib.admin.area_mapping_service import _merge_plans
        result = _merge_plans({'plan-1': 'Sprint'}, None)
        assert result['plan-1']['enabled'] is True


class TestRefreshSingle:
    def _make_azure_mock(self, team_ids=('t1',), plans=None):
        if plans is None:
            plans = [{'id': 'p1', 'name': 'PI 1', 'teams': [{'id': 't1'}]}]
        client = MagicMock()
        client.get_team_from_area_path.return_value = set(team_ids)
        client.get_all_plans.return_value = plans
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=client)
        ctx.__exit__ = MagicMock(return_value=False)
        azure_svc = MagicMock()
        azure_svc.connect.return_value = ctx
        return azure_svc

    def _make_admin_svc(self, area_path='Proj\\Team'):
        admin_svc = MagicMock()
        admin_svc.get_project_map.return_value = [
            {'area_path': area_path, 'id': 'project-proj', 'name': 'Proj'}
        ]
        admin_svc.get_config.return_value = {}
        return admin_svc

    def test_area_resolution_distinguishes_same_name_projects(self):
        from planner_lib.admin.area_mapping_service import _find_project_id

        projects = [
            {'id': 'first', 'name': 'Shared', 'area_path': 'Org\\First'},
            {'id': 'second', 'name': 'Shared', 'area_path': 'Org\\Second'},
        ]

        assert _find_project_id('Org\\First\\Team', projects) == 'first'
        assert _find_project_id('Org\\Second\\Team', projects) == 'second'

    def test_returns_ok_with_plans(self):
        from planner_lib.admin import area_mapping_service
        azure_svc = self._make_azure_mock()
        admin_svc = self._make_admin_svc('Proj\\Team')

        result = area_mapping_service.refresh_single(
            'Proj\\Team', 'my-pat', azure_svc, admin_svc
        )

        assert result['ok'] is True
        assert 'p1' in result['plans']
        assert result['plans']['p1']['name'] == 'PI 1'
        assert result['project_id'] == 'project-proj'

    def test_raises_value_error_on_empty_area_path(self):
        from planner_lib.admin import area_mapping_service
        with pytest.raises(ValueError, match='area_path'):
            area_mapping_service.refresh_single('', 'pat', MagicMock(), MagicMock())

    def test_save_config_raw_called(self):
        from planner_lib.admin import area_mapping_service
        azure_svc = self._make_azure_mock()
        admin_svc = self._make_admin_svc('Proj\\Team')

        area_mapping_service.refresh_single('Proj\\Team', 'pat', azure_svc, admin_svc)

        admin_svc.save_config_raw.assert_called_once()
        key = admin_svc.save_config_raw.call_args[0][0]
        assert key == 'area_plan_map'

    def test_invalidates_project_discovery_cache_before_refresh(self):
        from planner_lib.admin import area_mapping_service
        azure_svc = self._make_azure_mock()
        admin_svc = self._make_admin_svc('Proj\\Team')

        area_mapping_service.refresh_single('Proj\\Team', 'pat', azure_svc, admin_svc)

        client = azure_svc.connect.return_value.__enter__.return_value
        client.invalidate_plans.assert_called_once_with('Proj')
        assert client.method_calls.index(call.invalidate_plans('Proj')) < client.method_calls.index(
            call.get_all_plans('Proj')
        )

    def test_refresh_persists_to_shared_config_storage(self):
        from planner_lib.admin import area_mapping_service
        from planner_lib.admin.service import AdminService
        from planner_lib.backend.config import ConfigBackend
        from planner_lib.storage.memory_backend import MemoryStorage

        storage = MemoryStorage()
        project_repository = MagicMock()
        project_repository.get_project_map.return_value = [
            {'area_path': 'Proj\\Team', 'id': 'project-proj', 'name': 'Proj'}
        ]
        admin_svc = AdminService(
            storage=storage,
            project_repository=project_repository,
            account_manager=MagicMock(),
            azure_client=MagicMock(),
        )

        area_mapping_service.refresh_single(
            'Proj\\Team', 'pat', self._make_azure_mock(), admin_svc
        )

        stored = ConfigBackend(storage=storage).fetch_area_plan_map()
        assert stored['project-proj']['areas']['Proj\\Team']['plans'] == {
            'p1': {'name': 'PI 1', 'enabled': True}
        }


class TestRefreshAll:
    def test_raises_value_error_on_missing_pat(self):
        from planner_lib.admin import area_mapping_service
        admin_svc = MagicMock()
        admin_svc.get_project_map.return_value = []
        admin_svc.get_config.return_value = {}
        with pytest.raises(ValueError, match='PAT'):
            area_mapping_service.refresh_all('', MagicMock(), admin_svc)

    def test_refresh_all_returns_ok(self):
        from planner_lib.admin import area_mapping_service

        client = MagicMock()
        client.get_all_plans.return_value = [
            {'id': 'p1', 'name': 'PI 1', 'teams': [{'id': 't1'}]}
        ]
        client.get_team_from_area_path.return_value = {'t1'}
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=client)
        ctx.__exit__ = MagicMock(return_value=False)
        azure_svc = MagicMock()
        azure_svc.connect.return_value = ctx

        admin_svc = MagicMock()
        admin_svc.get_project_map.return_value = [
            {'area_path': 'Proj\\Team', 'id': 'project-proj'}
        ]
        admin_svc.get_config.return_value = {}

        result = area_mapping_service.refresh_all('pat', azure_svc, admin_svc)

        assert result['ok'] is True
        assert 'Proj\\Team' in result['results']
        assert result['results']['Proj\\Team']['ok'] is True

    def test_refresh_all_saves_config(self):
        from planner_lib.admin import area_mapping_service

        client = MagicMock()
        client.get_all_plans.return_value = []
        client.get_team_from_area_path.return_value = set()
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=client)
        ctx.__exit__ = MagicMock(return_value=False)
        azure_svc = MagicMock()
        azure_svc.connect.return_value = ctx

        admin_svc = MagicMock()
        admin_svc.get_project_map.return_value = [
            {'area_path': 'A\\B', 'id': 'proj-a'}
        ]
        admin_svc.get_config.return_value = {}

        area_mapping_service.refresh_all('pat', azure_svc, admin_svc)

        admin_svc.save_config_raw.assert_called_once()
        assert admin_svc.save_config_raw.call_args[0][0] == 'area_plan_map'
