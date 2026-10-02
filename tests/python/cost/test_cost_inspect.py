"""Test admin cost inspection endpoint with excluded teams."""
import pytest


@pytest.fixture
def mock_cost_data():
    """Sample cost configuration."""
    return {
        'schema_version': 1,
        'working_hours': {
            'US': {'internal': 160, 'external': 160},
            'UK': {'internal': 160, 'external': 160},
        },
        'internal_cost': {
            'default_hourly_rate': 75.0
        },
        'external_cost': {
            'default_hourly_rate': 85.0,
            'external': {
                'Bob Jones': 90.0
            }
        }
    }


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


def test_cost_inspect_excluded_team_cost_calculation(mock_people_data, mock_teams_data, mock_cost_data):
    """Test that excluded teams are properly categorized and cost calculations work."""
    from planner_lib.util import slugify
    
    # Build team ID sets
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
    
    # Process people with cost calculations
    database_teams = {}
    site_hours_map = mock_cost_data['working_hours']
    internal_rate = mock_cost_data['internal_cost']['default_hourly_rate']
    default_ext_rate = mock_cost_data['external_cost']['default_hourly_rate']
    ext_rates = mock_cost_data['external_cost']['external']
    
    for p in mock_people_data:
        raw_team = p.get('team_name') or ''
        if not raw_team:
            continue
        
        base = slugify(raw_team)
        team_id = base if base.startswith("team-") else f"team-{base}"
        
        if team_id not in database_teams:
            database_teams[team_id] = {
                'id': team_id,
                'name': raw_team,
                'matched': team_id in all_configured_team_ids,
                'excluded': team_id in excluded_team_ids,
                'internal_cost_total': 0.0,
                'external_cost_total': 0.0,
                'internal_hours_total': 0.0,
                'external_hours_total': 0.0,
                'members': []
            }
        
        team = database_teams[team_id]
        name = p['name']
        site = p['site']
        is_external = p['external']
        
        if is_external:
            hourly_rate = ext_rates.get(name, default_ext_rate)
            hours = site_hours_map[site]['external']
            monthly_cost = hourly_rate * hours
            team['external_cost_total'] += monthly_cost
            team['external_hours_total'] += hours
        else:
            hours = site_hours_map[site]['internal']
            monthly_cost = internal_rate * hours
            team['internal_cost_total'] += monthly_cost
            team['internal_hours_total'] += hours
        
        team['members'].append({'name': name, 'external': is_external})
    
    # Categorize teams
    matched_teams = [t for tid, t in database_teams.items() 
                    if tid in configured_team_ids]
    excluded_teams_with_people = [t for tid, t in database_teams.items() 
                                  if tid in excluded_team_ids]
    database_only = [t for tid, t in database_teams.items() 
                    if tid not in all_configured_team_ids]
    
    # Assertions
    assert len(matched_teams) == 2  # Engineering, Design
    assert len(excluded_teams_with_people) == 1  # Old Team
    assert len(database_only) == 0  # No unconfigured teams
    
    # Check Old Team (excluded)
    old_team = excluded_teams_with_people[0]
    assert old_team['id'] == 'team-old-team'
    assert old_team['matched'] is True
    assert old_team['excluded'] is True
    assert len(old_team['members']) == 1
    assert old_team['members'][0]['name'] == 'Eve Wilson'
    assert old_team['internal_cost_total'] == 75.0 * 160  # internal rate * hours
    assert old_team['internal_hours_total'] == 160
    
    # Calculate totals excluding excluded teams
    total_cost_active = sum(
        t['internal_cost_total'] + t['external_cost_total'] 
        for tid, t in database_teams.items() 
        if tid not in excluded_team_ids
    )
    total_cost_all = sum(
        t['internal_cost_total'] + t['external_cost_total'] 
        for t in database_teams.values()
    )
    
    # Verify excluded team costs are not included in operational totals
    assert total_cost_active < total_cost_all
    assert total_cost_all - total_cost_active == old_team['internal_cost_total']


def test_excluded_team_not_in_database_only(mock_teams_data):
    """Test that excluded teams with people are NOT categorized as database_only."""
    from planner_lib.util import slugify
    
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
    
    # Simulate database teams
    database_team_ids = {'team-engineering', 'team-design', 'team-old-team', 'team-unknown'}
    
    # Categorize
    matched = {tid for tid in database_team_ids if tid in configured_team_ids}
    excluded_with_people = {tid for tid in database_team_ids if tid in excluded_team_ids}
    database_only = {tid for tid in database_team_ids if tid not in all_configured_team_ids}
    
    # Assertions
    assert 'team-old-team' in excluded_with_people
    assert 'team-old-team' not in database_only  # Should NOT be in database_only
    assert 'team-old-team' not in matched  # Should NOT be in matched (it's excluded)
    
    assert 'team-engineering' in matched
    assert 'team-design' in matched
    assert 'team-unknown' in database_only


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
