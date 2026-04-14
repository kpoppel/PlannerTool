"""CostInspector: debugging tool for team/cost data matching.

Extracted from the ``admin_inspect_cost`` route handler in ``admin/api.py``.
Provides a single ``inspect(admin_svc, people_service, team_service)`` function
that returns a rich inspection dict without any HTTP dependency.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def inspect(admin_svc, people_service, team_service) -> dict:
    """Return a detailed cost-inspection report.

    Computes:
    - All teams defined in the people database
    - All teams configured via team_service
    - Matching status between the two sources
    - Monthly cost and hours per team/member
    - Teams only in config or only in the database

    Parameters
    ----------
    admin_svc:
        AdminService instance (provides config CRUD)
    people_service:
        PeopleService instance
    team_service:
        TeamService instance
    """
    from planner_lib.util import slugify

    # --- People config (for display) ---
    database_path = 'config/database.yaml'
    try:
        people_cfg = people_service.get_config()
        database_path = people_cfg.get('database_file', database_path)
    except Exception as e:
        logger.warning("Failed to load people config: %s", e)

    cost_cfg = admin_svc.get_config('cost_config') or {}

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
                'source': 'teams.yml (via team_service)',
            }
            if t.get('exclude', False):
                excluded_teams.append(team_obj)
            else:
                configured_teams.append(team_obj)
    except Exception as e:
        logger.warning("Failed to get teams from team_service: %s", e)

    configured_team_ids = {t['id'] for t in configured_teams}
    excluded_team_ids = {t['id'] for t in excluded_teams}
    all_configured_team_ids = configured_team_ids | excluded_team_ids

    # --- Cost parameters ---
    site_hours_map = cost_cfg.get('working_hours', {}) or {}
    external_cfg = cost_cfg.get('external_cost', {}) or {}
    ext_rates = external_cfg.get('external', {}) or {}
    default_ext_rate = float(external_cfg.get('default_hourly_rate', 0) or 0)
    internal_default_rate = float(cost_cfg.get('internal_cost', {}).get('default_hourly_rate', 0) or 0)

    # --- Build per-team data from people ---
    database_teams: dict = {}
    unmatched_people = []

    for p in people:
        raw_team = p.get('team_name') or p.get('team') or ''
        if not raw_team:
            unmatched_people.append({'name': p.get('name', 'Unknown'), 'reason': 'No team_name specified'})
            continue

        base = slugify(raw_team)
        team_id = base if base.startswith('team-') else f'team-{base}'

        if team_id not in database_teams:
            database_teams[team_id] = {
                'id': team_id,
                'name': raw_team,
                'source': database_path,
                'matched': team_id in all_configured_team_ids,
                'excluded': team_id in excluded_team_ids,
                'members': [],
                'internal_count': 0,
                'external_count': 0,
                'internal_hours_total': 0.0,
                'external_hours_total': 0.0,
                'internal_cost_total': 0.0,
                'external_cost_total': 0.0,
            }

        team = database_teams[team_id]
        name = p.get('name', 'Unknown')
        site = p.get('site', '')
        is_external = bool(p.get('external'))

        if is_external:
            hourly_rate = float(ext_rates.get(name, default_ext_rate) or 0)
            hours = int(site_hours_map.get(site, {}).get('external', 0) or 0)
            team['external_count'] += 1
            team['external_hours_total'] += hours
            monthly_cost = hourly_rate * hours
            team['external_cost_total'] += monthly_cost
            team['members'].append({
                'name': name, 'external': True, 'site': site,
                'hourly_rate': hourly_rate, 'hours_per_month': hours, 'monthly_cost': monthly_cost,
            })
        else:
            hourly_rate = internal_default_rate
            hours = int(site_hours_map.get(site, {}).get('internal', 0) or 0)
            team['internal_count'] += 1
            team['internal_hours_total'] += hours
            monthly_cost = hourly_rate * hours
            team['internal_cost_total'] += monthly_cost
            team['members'].append({
                'name': name, 'external': False, 'site': site,
                'hourly_rate': hourly_rate, 'hours_per_month': hours, 'monthly_cost': monthly_cost,
            })

    # --- Categorise ---
    database_team_ids = set(database_teams.keys())
    config_only = [t for t in configured_teams if t['id'] not in database_team_ids]
    matched_teams = [t for tid, t in database_teams.items() if tid in configured_team_ids]
    excluded_teams_with_people = [t for tid, t in database_teams.items() if tid in excluded_team_ids]
    database_only = [t for tid, t in database_teams.items() if tid not in all_configured_team_ids]

    # --- Totals (exclude excluded teams) ---
    active_ids = database_team_ids - excluded_team_ids
    total_internal_cost = sum(t['internal_cost_total'] for tid, t in database_teams.items() if tid in active_ids)
    total_external_cost = sum(t['external_cost_total'] for tid, t in database_teams.items() if tid in active_ids)
    total_internal_hours = sum(t['internal_hours_total'] for tid, t in database_teams.items() if tid in active_ids)
    total_external_hours = sum(t['external_hours_total'] for tid, t in database_teams.items() if tid in active_ids)

    return {
        'configured_teams': configured_teams,
        'excluded_teams': excluded_teams_with_people,
        'database_teams': list(database_teams.values()),
        'matched_teams': matched_teams,
        'config_only_teams': config_only,
        'database_only_teams': database_only,
        'unmatched_people': unmatched_people,
        'summary': {
            'database_path': database_path,
            'configured_count': len(configured_teams),
            'excluded_count': len(excluded_teams_with_people),
            'database_count': len(database_teams),
            'matched_count': len(matched_teams),
            'config_only_count': len(config_only),
            'database_only_count': len(database_only),
            'unmatched_people_count': len(unmatched_people),
            'total_internal_cost_monthly': round(total_internal_cost, 2),
            'total_external_cost_monthly': round(total_external_cost, 2),
            'total_internal_hours_monthly': round(total_internal_hours, 2),
            'total_external_hours_monthly': round(total_external_hours, 2),
        },
        'cost_config': {
            'internal_hourly_rate': internal_default_rate,
            'external_hourly_rate_default': default_ext_rate,
            'site_hours': site_hours_map,
        },
    }
