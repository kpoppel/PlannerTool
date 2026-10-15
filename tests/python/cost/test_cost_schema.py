import pytest

from planner_lib.cost.service import build_cost_schema


def test_cost_schema_uses_configured_display_name_for_opaque_project_ids():
    project_id = '11111111-1111-4111-8111-111111111111'
    result = build_cost_schema(
        {
            project_id: {
                'totals': {
                    'internal': {'hours': {}, 'cost': {}},
                    'external': {'hours': {}, 'cost': {}},
                    'complete': True,
                },
            },
        },
        project_names={project_id: 'Release / Planning'},
    )

    assert result['projects'][0]['id'] == project_id
    assert result['projects'][0]['name'] == 'Release / Planning'


def test_cost_schema_rejects_missing_project_display_name():
    with pytest.raises(ValueError, match='No configured display name'):
        build_cost_schema({
            '11111111-1111-4111-8111-111111111111': {
                'totals': {'complete': True},
            },
        })
