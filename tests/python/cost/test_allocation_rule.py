import json
from copy import deepcopy
from pathlib import Path

import pytest

from planner_lib.cost.allocation_rule import (
    allocation_conflicts, expand_group_allocations, resolve_effective_allocations,
)


CASES = json.loads(
    (Path(__file__).parents[2] / 'fixtures/allocation_rule/cases.json').read_text()
)
GROUP_CASES = json.loads(
    (Path(__file__).parents[2] / 'fixtures/allocation_rule/groups.json').read_text()
)


@pytest.mark.parametrize('case', GROUP_CASES, ids=lambda case: case['name'])
def test_shared_group_allocation_rule(case: dict) -> None:
    """Both runtimes resolve original reservations before expanding member percentages."""
    original = deepcopy(case['features'])
    resolved = resolve_effective_allocations(case['features'], memberships=case['memberships'])
    assert resolved == case['expected']
    assert allocation_conflicts(case['features'], case['memberships']) == case['conflicts']
    if case['expanded'] is not None:
        assert expand_group_allocations(resolved, case['memberships']) == case['expanded']
    assert case['features'] == original


def test_deep_tree_does_not_require_recursive_traversal():
    features = [
        {'id': str(index), 'parentId': None if index == 0 else str(index - 1),
         'start': '2025-01-01', 'end': '2025-01-31',
         'capacity': [{'team': 'A', 'capacity': 20}] if index in (0, 4999) else []}
        for index in range(5000)
    ]
    result = resolve_effective_allocations(features)
    assert result['0'] == []
    assert result['4999'] == [{'team': 'A', 'capacity': 20}]


@pytest.mark.parametrize('case', CASES, ids=lambda case: case['name'])
def test_shared_allocation_rule(case):
    original = deepcopy(case['features'])
    if 'error' in case:
        with pytest.raises(ValueError, match=case['error']):
            resolve_effective_allocations(case['features'])
    else:
        assert resolve_effective_allocations(case['features']) == case['expected']
        assert resolve_effective_allocations(list(reversed(case['features']))) == case['expected']
    assert case['features'] == original