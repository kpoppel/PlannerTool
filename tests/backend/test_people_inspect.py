"""Test admin people inspection endpoint."""
import pytest
from unittest.mock import MagicMock


@pytest.fixture
def mock_people_data():
    """Sample people data for testing."""
    return [
        {
            'name': 'Alice Smith',
            'team_name': 'Engineering',
            'site': 'US',
            'external': False
        },
        {
            'name': 'Bob Jones',
            'team_name': 'Engineering',
            'site': 'UK',
            'external': True
        },
        {
            'name': 'Charlie Davis',
            'team_name': 'Design',
            'site': 'US',
            'external': False
        },
        {
            'name': 'Diana Prince',
            'site': 'US',
            'external': False
        },
        {
            'name': 'Eve Wilson',
            'team_name': 'Old Team',
            'site': 'US',
            'external': False
        }
    ]


@pytest.fixture
def mock_teams_data():
    """Sample teams configuration."""
    return {
        'schema_version': 2,
        'teams': [
            {'name': 'Engineering', 'short_name': 'ENG', 'exclude': False},
            {'name': 'Design', 'short_name': 'DES', 'exclude': False},
            {'name': 'Marketing', 'short_name': 'MKT', 'exclude': False},
            {'name': 'Old Team', 'short_name': 'OLD', 'exclude': True},
        ]
    }


def test_people_inspect_grouping(mock_people_data, mock_teams_data):
    """Test that people are correctly grouped by teams."""
    from planner_lib.util import slugify
    
    # Simulate the grouping logic from the endpoint
    teams_with_people = {}
    unassigned_people = []
    
    configured_team_ids = {
        slugify(t['name'], prefix='team-') 
        for t in mock_teams_data['teams'] 
        if not t.get('exclude', False)
    }
    excluded_team_ids = {
        slugify(t['name'], prefix='team-') 
        for t in mock_teams_data['teams'] 
        if t.get('exclude', False)
    }
    all_configured_team_ids = configured_team_ids | excluded_team_ids
    
    for p in mock_people_data:
        raw_team = p.get('team_name') or p.get('team') or ''
        if not raw_team:
            unassigned_people.append({
                'name': p.get('name', 'Unknown'),
                'reason': 'No team_name specified'
            })
            continue
        
        base = slugify(raw_team)
        team_id = base if base.startswith("team-") else f"team-{base}"
        
        if team_id not in teams_with_people:
            teams_with_people[team_id] = {
                'id': team_id,
                'name': raw_team,
                'matched': team_id in all_configured_team_ids,
                'excluded': team_id in excluded_team_ids,
                'members': [],
                'internal_count': 0,
                'external_count': 0,
            }
        
        team = teams_with_people[team_id]
        is_external = bool(p.get('external'))
        
        if is_external:
            team['external_count'] += 1
        else:
            team['internal_count'] += 1
        
        team['members'].append({
            'name': p.get('name', 'Unknown'),
            'external': is_external,
            'site': p.get('site', ''),
        })
    
    # Assertions
    assert len(teams_with_people) == 3  # Engineering, Design, Old Team
    assert len(unassigned_people) == 1  # Diana Prince
    assert unassigned_people[0]['name'] == 'Diana Prince'
    
    # Check Engineering team
    eng_team = teams_with_people.get('team-engineering')
    assert eng_team is not None
    assert eng_team['name'] == 'Engineering'
    assert len(eng_team['members']) == 2
    assert eng_team['internal_count'] == 1
    assert eng_team['external_count'] == 1
    assert eng_team['matched'] is True
    assert eng_team['excluded'] is False
    
    # Check Design team
    design_team = teams_with_people.get('team-design')
    assert design_team is not None
    assert design_team['name'] == 'Design'
    assert len(design_team['members']) == 1
    assert design_team['internal_count'] == 1
    assert design_team['external_count'] == 0
    assert design_team['matched'] is True
    assert design_team['excluded'] is False
    
    # Check Old Team (excluded but should be matched)
    old_team = teams_with_people.get('team-old-team')
    assert old_team is not None
    assert old_team['name'] == 'Old Team'
    assert len(old_team['members']) == 1
    assert old_team['internal_count'] == 1
    assert old_team['external_count'] == 0
    assert old_team['matched'] is True  # Should be matched because it's configured
    assert old_team['excluded'] is True  # Should be marked as excluded


def test_people_inspect_team_matching(mock_teams_data):
    """Test team matching logic."""
    from planner_lib.util import slugify
    
    # Configured teams (non-excluded)
    configured_teams = [
        t for t in mock_teams_data['teams'] 
        if not t.get('exclude', False)
    ]
    configured_team_ids = {
        slugify(t['name'], prefix='team-') for t in configured_teams
    }
    
    # Excluded teams
    excluded_teams = [
        t for t in mock_teams_data['teams']
        if t.get('exclude', False)
    ]
    excluded_team_ids = {
        slugify(t['name'], prefix='team-') for t in excluded_teams
    }
    
    # All configured teams (including excluded)
    all_configured_team_ids = configured_team_ids | excluded_team_ids
    
    # Teams with people
    database_team_ids = {'team-engineering', 'team-design', 'team-operations', 'team-old-team'}
    
    # Identify categories
    matched = database_team_ids & configured_team_ids  # Active teams with people
    excluded_with_people = database_team_ids & excluded_team_ids  # Excluded teams with people
    unmatched = database_team_ids - all_configured_team_ids  # Not configured at all
    without_people = configured_team_ids - database_team_ids  # Configured but no people
    
    assert matched == {'team-engineering', 'team-design'}
    assert excluded_with_people == {'team-old-team'}
    assert unmatched == {'team-operations'}
    assert without_people == {'team-marketing'}


def test_excluded_team_with_people():
    """Test that excluded teams with people are properly categorized."""
    from planner_lib.util import slugify
    
    # Simulated data
    teams_config = [
        {'name': 'Active Team', 'short_name': 'AT', 'exclude': False},
        {'name': 'Excluded Team', 'short_name': 'ET', 'exclude': True},
    ]
    
    people = [
        {'name': 'Person 1', 'team_name': 'Active Team', 'site': 'US', 'external': False},
        {'name': 'Person 2', 'team_name': 'Excluded Team', 'site': 'US', 'external': False},
    ]
    
    configured_team_ids = {
        slugify(t['name'], prefix='team-')
        for t in teams_config
        if not t.get('exclude', False)
    }
    excluded_team_ids = {
        slugify(t['name'], prefix='team-')
        for t in teams_config
        if t.get('exclude', False)
    }
    all_configured_team_ids = configured_team_ids | excluded_team_ids
    
    # Process people
    teams_with_people = {}
    for p in people:
        base = slugify(p['team_name'])
        team_id = base if base.startswith("team-") else f"team-{base}"
        
        if team_id not in teams_with_people:
            teams_with_people[team_id] = {
                'id': team_id,
                'name': p['team_name'],
                'matched': team_id in all_configured_team_ids,
                'excluded': team_id in excluded_team_ids,
            }
    
    # Assertions
    assert len(teams_with_people) == 2
    
    active = teams_with_people['team-active-team']
    assert active['matched'] is True
    assert active['excluded'] is False
    
    excluded = teams_with_people['team-excluded-team']
    assert excluded['matched'] is True  # Should be matched (it's configured)
    assert excluded['excluded'] is True  # Should be marked as excluded


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
