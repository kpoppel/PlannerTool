"""Backend-neutral plan validation is separate from ADO area/process rules."""
import pytest

from planner_lib.azure.catalogue import CatalogueError, validate_plans
from planner_lib.domain.plans import validate_plan_common

CONTAINERS = ['project', 'team']


def _plan(**overrides):
    plan = {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Plan', 'type': 'project',
            'task_types': ['Feature'], 'closed_history_days': 0}
    plan.update(overrides)
    return plan


def test_common_validation_accepts_a_plan_without_area_path():
    validate_plan_common(_plan(), CONTAINERS)


@pytest.mark.parametrize('overrides, message', [
    ({'name': ' '}, 'name'),
    ({'type': 'portfolio'}, 'level'),
    ({'closed_history_days': -1}, 'closed_history_days'),
    ({'closed_history_days': True}, 'closed_history_days'),
    ({'task_types': []}, 'task_types'),
    ({'task_types': ['']}, 'task_types'),
])
def test_common_validation_rejects_invalid_generic_fields(overrides, message):
    with pytest.raises(ValueError, match=message):
        validate_plan_common(_plan(**overrides), CONTAINERS)


def test_ado_validation_still_requires_area_path():
    content = {'container_types': CONTAINERS, 'project_map': [_plan()]}
    with pytest.raises(CatalogueError, match='Area path is required'):
        validate_plans(content, {'processes': []})


def test_ado_validation_reports_generic_errors_as_catalogue_errors():
    content = {'container_types': CONTAINERS,
               'project_map': [_plan(name='', area_path='Project')]}
    with pytest.raises(CatalogueError, match='name'):
        validate_plans(content, {'processes': []})
