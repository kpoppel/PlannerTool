"""PeopleInspector: debug view for team/people data matching.

Extracted from the ``admin_inspect_people`` route handler in ``admin/api.py``.
Provides a single ``inspect(admin_svc, people_service, team_service)`` function
that returns a rich inspection dict without any HTTP dependency.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def inspect(admin_svc, people_service, team_service) -> dict:
    """Return a detailed people-inspection report.

    Groups people by team, identifies configured/unmatched/excluded teams,
    and highlights people with no team assignment.
    """
    from planner_lib.util import slugify

    # --- Database path (display only) ---
    database_path = 'config/database.yaml'
    try:
        people_cfg = admin_svc.get_config('people') or {}
        database_path = people_cfg.get('database_file', database_path)
    except Exception as e:
        logger.warning("Failed to load people config: %s", e)

    # --- People ---
    try:
        people = people_service.get_people()
    except Exception as e:
        logger.warning("Failed to load people from service: %s", e)
        people = []

    # --- Configured teams ---
    configured_teams = []
    excluded_teams = []
    try:
        teams_cfg = admin_svc.get_config('teams') or {}
        teams_list_all = teams_cfg.get('teams') or []

        for t in teams_list_all:
            if not isinstance(t, dict):
                continue
            team_id = slugify(t.get('name'), prefix='team-')
            team_obj = {
                'id': team_id,
                'name': t.get('name', ''),
                'short_name': t.get('short_name', ''),
                'excluded': t.get('exclude', False),
            }
            if t.get('exclude', False):
                excluded_teams.append(team_obj)
            else:
                configured_teams.append(team_obj)
    except Exception as e:
        logger.warning("Failed to get teams: %s", e)

    configured_team_ids = {t['id'] for t in configured_teams}
    excluded_team_ids = {t['id'] for t in excluded_teams}
    all_configured_team_ids = configured_team_ids | excluded_team_ids

    # --- Group people by team ---
    teams_with_people: dict = {}
    unassigned_people = []

    for p in people:
        raw_team = p.get('team_name') or p.get('team') or ''
        if not raw_team:
            unassigned_people.append({
                'name': p.get('name', 'Unknown'),
                'site': p.get('site', ''),
                'external': bool(p.get('external')),
                'reason': 'No team_name specified',
            })
            continue

        base = slugify(raw_team)
        team_id = base if base.startswith('team-') else f'team-{base}'

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

    # --- Categorise ---
    database_team_ids = set(teams_with_people.keys())
    matched_teams = [t for tid, t in teams_with_people.items() if tid in configured_team_ids]
    excluded_teams_with_people = [t for tid, t in teams_with_people.items() if tid in excluded_team_ids]
    unmatched_teams = [t for tid, t in teams_with_people.items() if tid not in all_configured_team_ids]
    teams_without_people = [t for t in configured_teams if t['id'] not in database_team_ids]

    # --- Totals ---
    total_people = len(people)
    total_internal = sum(1 for p in people if not p.get('external'))
    total_external = sum(1 for p in people if p.get('external'))

    return {
        'configured_teams': configured_teams,
        'excluded_teams': excluded_teams_with_people,
        'matched_teams': matched_teams,
        'unmatched_teams': unmatched_teams,
        'teams_without_people': teams_without_people,
        'unassigned_people': unassigned_people,
        'summary': {
            'database_path': database_path,
            'total_people': total_people,
            'total_internal': total_internal,
            'total_external': total_external,
            'configured_teams': len(configured_teams),
            'excluded_teams': len(excluded_teams_with_people),
            'matched_teams': len(matched_teams),
            'unmatched_teams': len(unmatched_teams),
            'teams_without_people': len(teams_without_people),
            'unassigned_people': len(unassigned_people),
        },
    }
