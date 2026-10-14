"""Shared availability contract for existing allocations and independently offered choices."""
import json
from pathlib import Path

import pytest

from planner_lib.domain.allocation_availability import (
    project_allocation_availability, validate_allocation_change,
)

FIXTURE = json.loads(
    (Path(__file__).parents[2] / 'fixtures/allocation_rule/availability.json').read_text()
)


def project(feature: dict) -> dict:
    """Project fixture availability independently of provenance or work-item type."""
    return project_allocation_availability(
        feature, FIXTURE['projects'], FIXTURE['catalogue'], FIXTURE['defaults'],
    )


@pytest.mark.parametrize('case', FIXTURE['cases'], ids=lambda case: case['name'])
def test_shared_availability(case: dict) -> None:
    """Both runtimes consume identical explicit default and override fixtures."""
    feature = {'id': 'item', 'project': case['owner'], 'capacity': case['capacity'],
               'sourcePlanIds': ['inherit'], 'type': 'not-the-container-type'}
    assert project(feature) == {'allowed_ids': case['allowed'], 'existing': case['existing']}


def test_retained_allocations_do_not_authorize_readdition() -> None:
    """A retained archived identity may be edited or removed but cannot be reintroduced."""
    feature = {'id': 'item', 'project': 'empty', 'capacity': [{'team': 'old', 'capacity': 40}]}
    validate_allocation_change(project(feature), [{'team': 'old', 'capacity': 70}])
    validate_allocation_change(project(feature), [])
    with pytest.raises(ValueError, match='old'):
        validate_allocation_change(project(dict(feature, capacity=[])), [{'team': 'old', 'capacity': 40}])


@pytest.mark.parametrize('capacity', [
    [{'team': 'A', 'capacity': -1}], [{'team': 'A', 'capacity': 101}],
    [{'team': 'A', 'capacity': float('nan')}], [{'team': 'A', 'capacity': '20'}],
    [{'team': 'A', 'capacity': True}],
    [{'team': 'A', 'capacity': 20}, {'team': 'A', 'capacity': 30}],
])
def test_invalid_authored_allocations(capacity: list) -> None:
    """Authored percentages and identities are validated before storage or publication."""
    with pytest.raises(ValueError):
        validate_allocation_change(project({'project': 'inherit', 'capacity': []}), capacity)


def test_unknown_configuration_reference() -> None:
    """Configuration errors are not interpreted as an empty choice list."""
    with pytest.raises(ValueError, match='missing'):
        project_allocation_availability(
            {'project': 'inherit', 'capacity': []}, FIXTURE['projects'], FIXTURE['catalogue'],
            dict(FIXTURE['defaults'], Plan=['missing']),
        )


def test_retained_duplicate_unknown_rows_do_not_block_known_team_changes() -> None:
    """Unresolved duplicates stay unchanged rather than being deduplicated or reassigned."""
    capacity = [{'team': 'None', 'capacity': 20}, {'team': 'None', 'capacity': 20}]
    availability = project({'project': 'inherit', 'capacity': capacity})
    validate_allocation_change(availability, capacity + [{'team': 'A', 'capacity': 60}])
    for invalid in [
        capacity + [{'team': 'None', 'capacity': 20}],
        [{'team': 'None', 'capacity': 30}, capacity[1]], [capacity[0]], [],
    ]:
        with pytest.raises(ValueError, match='Unresolved duplicate'):
            validate_allocation_change(availability, invalid)