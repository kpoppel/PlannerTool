"""Tests for the four modules extracted from admin/api.py god handler.

Covers:
- schema.get_schema / get_schema deep copy / enrich_projects_schema
- cost_inspector.inspect return shape and computation
- people_inspector.inspect return shape and categorisation
- area_mapping_service._merge_plans / refresh_single / refresh_all
"""
import copy
import pytest
from unittest.mock import MagicMock, patch


# ===========================================================================
# schema
# ===========================================================================

class TestAdminSchema:
    def setup_method(self):
        from planner_lib.admin import schema as _s
        self.schema = _s

    def test_get_schema_known_types(self):
        for type_name in ('system', 'projects', 'teams', 'people', 'area_mappings', 'cost'):
            result = self.schema.get_schema(type_name)
            assert isinstance(result, dict), f"Expected dict for {type_name}"
            assert result.get('type') == 'object'

    def test_get_schema_unknown_returns_none(self):
        assert self.schema.get_schema('nonexistent') is None
        assert self.schema.get_schema('') is None

    def test_get_schema_returns_deep_copy(self):
        s1 = self.schema.get_schema('system')
        s1['_mutation'] = 'injected'
        s2 = self.schema.get_schema('system')
        assert '_mutation' not in s2, "Mutation leaked into the registry"

    def test_enrich_projects_schema_updates_enum_and_defaults(self):
        schema = self.schema.get_schema('projects')
        azure_client = MagicMock()
        conn_ctx = MagicMock()
        mock_client_instance = MagicMock()
        mock_client_instance.get_work_item_metadata.return_value = {
            'types': ['Bug', 'Task'],
            'states': ['Active', 'Closed'],
        }
        conn_ctx.__enter__ = MagicMock(return_value=mock_client_instance)
        conn_ctx.__exit__ = MagicMock(return_value=False)
        azure_client.connect.return_value = conn_ctx

        admin_svc = MagicMock()
        admin_svc.get_config.return_value = {
            'project_map': [{'area_path': 'MyProject\\Team\\Area'}]
        }

        self.schema.enrich_projects_schema(
            schema,
            azure_client=azure_client,
            pat='my-pat',
            admin_svc=admin_svc,
        )

        project_items = schema['properties']['project_map']['items']['properties']
        assert project_items['task_types']['items']['enum'] == ['Bug', 'Task']
        assert project_items['include_states']['default'] == ['Active', 'Closed']
        assert project_items['display_states']['default'] == ['Active', 'Closed']

    def test_enrich_projects_schema_noop_on_error(self):
        """Enrich silently ignores Azure failures."""
        schema = self.schema.get_schema('projects')
        azure_client = MagicMock()
        azure_client.connect.side_effect = RuntimeError('no connection')

        admin_svc = MagicMock()
        admin_svc.get_config.return_value = {
            'project_map': [{'area_path': 'MyProject\\Team'}]
        }

        # Should not raise
        self.schema.enrich_projects_schema(
            schema,
            azure_client=azure_client,
            pat='token',
            admin_svc=admin_svc,
        )


# ===========================================================================
# cost_inspector
# ===========================================================================

class TestCostInspector:
    def _make_stubs(self, people=(), teams_cfg=None, cost_cfg=None):
        admin_svc = MagicMock()
        admin_svc.get_config.side_effect = lambda key, **_: {
            'cost_config': cost_cfg or {},
            'teams': teams_cfg or {'teams': []},
        }.get(key, {})

        people_svc = MagicMock()
        people_svc.get_people.return_value = list(people)
        people_svc.get_config.return_value = {'database_file': 'test.yaml'}

        team_svc = MagicMock()
        team_svc.list_teams.return_value = []

        return admin_svc, people_svc, team_svc

    def test_returns_expected_top_level_keys(self):
        from planner_lib.admin import cost_inspector
        admin_svc, people_svc, team_svc = self._make_stubs()
        result = cost_inspector.inspect(admin_svc, people_svc, team_svc)

        for key in ('configured_teams', 'excluded_teams', 'database_teams',
                    'matched_teams', 'config_only_teams', 'database_only_teams',
                    'unmatched_people', 'summary', 'cost_config'):
            assert key in result, f"Missing key: {key}"

    def test_person_without_team_goes_to_unmatched(self):
        from planner_lib.admin import cost_inspector
        people = [{'name': 'Alice', 'site': 'NYC'}]
        admin_svc, people_svc, team_svc = self._make_stubs(people=people)
        result = cost_inspector.inspect(admin_svc, people_svc, team_svc)

        assert len(result['unmatched_people']) == 1
        assert result['unmatched_people'][0]['name'] == 'Alice'

    def test_internal_person_computed_cost(self):
        from planner_lib.admin import cost_inspector
        people = [{'name': 'Bob', 'team_name': 'Backend', 'site': 'NYC'}]
        cost_cfg = {
            'working_hours': {'NYC': {'internal': 160, 'external': 140}},
            'internal_cost': {'default_hourly_rate': 100},
            'external_cost': {'default_hourly_rate': 80, 'external': {}},
        }
        teams_cfg = {'teams': [{'name': 'Backend'}]}
        admin_svc, people_svc, team_svc = self._make_stubs(
            people=people, teams_cfg=teams_cfg, cost_cfg=cost_cfg
        )
        result = cost_inspector.inspect(admin_svc, people_svc, team_svc)

        assert result['summary']['total_internal_cost_monthly'] == 16000.0
        assert result['summary']['total_internal_hours_monthly'] == 160.0

    def test_excluded_teams_populated(self):
        from planner_lib.admin import cost_inspector
        people = [{'name': 'Carol', 'team_name': 'Contractors', 'site': 'LON', 'external': True}]
        cost_cfg = {
            'working_hours': {'LON': {'internal': 160, 'external': 140}},
            'internal_cost': {'default_hourly_rate': 100},
            'external_cost': {'default_hourly_rate': 50, 'external': {}},
        }
        teams_cfg = {'teams': [{'name': 'Contractors', 'exclude': True}]}
        admin_svc, people_svc, team_svc = self._make_stubs(
            people=people, teams_cfg=teams_cfg, cost_cfg=cost_cfg
        )
        result = cost_inspector.inspect(admin_svc, people_svc, team_svc)

        # Contractor team is excluded, so its cost should not appear in totals
        assert result['summary']['total_external_cost_monthly'] == 0.0
        assert len(result['excluded_teams']) == 1


# ===========================================================================
# people_inspector
# ===========================================================================

class TestPeopleInspector:
    def _make_stubs(self, people=(), teams_cfg=None):
        admin_svc = MagicMock()

        def _get_config(key, **_):
            if key == 'teams':
                return teams_cfg or {'teams': []}
            if key == 'people':
                return {'database_file': 'test.yaml'}
            return {}

        admin_svc.get_config.side_effect = _get_config

        people_svc = MagicMock()
        people_svc.get_people.return_value = list(people)

        team_svc = MagicMock()
        team_svc.list_teams.return_value = []

        return admin_svc, people_svc, team_svc

    def test_returns_expected_top_level_keys(self):
        from planner_lib.admin import people_inspector
        admin_svc, people_svc, team_svc = self._make_stubs()
        result = people_inspector.inspect(admin_svc, people_svc, team_svc)

        for key in ('configured_teams', 'excluded_teams', 'matched_teams',
                    'unmatched_teams', 'teams_without_people',
                    'unassigned_people', 'summary'):
            assert key in result, f"Missing key: {key}"

    def test_person_without_team_goes_to_unassigned(self):
        from planner_lib.admin import people_inspector
        people = [{'name': 'Dave', 'site': 'NYC'}]
        admin_svc, people_svc, team_svc = self._make_stubs(people=people)
        result = people_inspector.inspect(admin_svc, people_svc, team_svc)

        assert len(result['unassigned_people']) == 1
        assert result['unassigned_people'][0]['name'] == 'Dave'

    def test_matched_team_shows_in_matched(self):
        from planner_lib.admin import people_inspector
        people = [{'name': 'Eve', 'team_name': 'Alpha', 'site': 'NYC'}]
        teams_cfg = {'teams': [{'name': 'Alpha'}]}
        admin_svc, people_svc, team_svc = self._make_stubs(
            people=people, teams_cfg=teams_cfg
        )
        result = people_inspector.inspect(admin_svc, people_svc, team_svc)

        assert len(result['matched_teams']) == 1
        assert result['matched_teams'][0]['name'] == 'Alpha'
        assert len(result['unassigned_people']) == 0

    def test_db_only_team_goes_to_unmatched(self):
        from planner_lib.admin import people_inspector
        # Person belongs to a team not in configuration
        people = [{'name': 'Frank', 'team_name': 'GhostTeam', 'site': 'NYC'}]
        teams_cfg = {'teams': []}  # no configured teams
        admin_svc, people_svc, team_svc = self._make_stubs(
            people=people, teams_cfg=teams_cfg
        )
        result = people_inspector.inspect(admin_svc, people_svc, team_svc)

        assert len(result['unmatched_teams']) == 1
        assert result['unmatched_teams'][0]['name'] == 'GhostTeam'


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
