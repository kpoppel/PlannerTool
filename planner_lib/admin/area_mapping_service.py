"""AreaMappingService: Azure area-path → delivery-plan resolution.

Extracted from ``admin_refresh_area_mapping`` and
``admin_refresh_all_area_mappings`` in ``admin/api.py``.

Public API:
- ``refresh_single(area_path, pat, azure_client, admin_svc)``
- ``refresh_all(pat, azure_client, admin_svc)``

Both functions are pure business logic (no HTTP dependency) that return
dicts suitable for inclusion in FastAPI responses.

Raises ``ValueError`` on bad input; callers should map to HTTP 400.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def refresh_single(area_path: str, pat: str, azure_client, admin_svc) -> dict:
    """Resolve area → plan mapping for one *area_path*, persist and return result.

    Parameters
    ----------
    area_path:
        Azure DevOps area path, e.g. ``Project\\\\Team\\\\SubArea``.
    pat:
        Personal access token.
    azure_client:
        ``AzureService`` instance (context manager ``connect(pat)``).
    admin_svc:
        ``AdminService`` instance (``get_config`` / ``save_config_raw``).
    """
    if not area_path or not isinstance(area_path, str):
        raise ValueError('Missing or invalid area_path')

    project_name = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]
    plan_dict: dict = {}

    with azure_client.connect(pat) as client:
        owner_team_ids = client.get_team_from_area_path(project_name, area_path)  # type: ignore
        logger.info("Found %d teams owning area %s: %s", len(owner_team_ids), area_path, owner_team_ids)
        all_plans = client.get_all_plans(project_name)  # type: ignore
        logger.info("Found %d plans in project %s", len(all_plans), project_name)

        for plan in all_plans:
            plan_id = plan.get('id')
            plan_name = plan.get('name')
            if not plan_id:
                continue
            for team in plan.get('teams', []):
                team_id = team.get('id') if isinstance(team, dict) else str(team)
                if team_id in owner_team_ids:
                    plan_dict[str(plan_id)] = plan_name or str(plan_id)
                    logger.info("Plan %s (%s) matched via team %s", plan_name, plan_id, team_id)
                    break

    logger.info("Found %d plans associated with area %s", len(plan_dict), area_path)

    # Determine which configured project this area belongs to
    from planner_lib.util import slugify
    project_map = admin_svc.get_project_map()
    project_id = _find_project_id(area_path, project_name, project_map, slugify)

    if not project_id:
        raise ValueError(f'Could not determine project for area_path: {area_path}')

    # Merge with existing mapping, preserving existing enabled states
    existing: dict = admin_svc.get_config('area_plan_map') or {}
    now = datetime.now(timezone.utc).isoformat()

    proj_obj = existing.get(project_id) or {'areas': {}}
    proj_obj.setdefault('areas', {})
    old_plans = proj_obj['areas'].get(area_path, {}).get('plans', {})
    new_plans = _merge_plans(plan_dict, old_plans)

    proj_obj['areas'][area_path] = {'plans': new_plans}
    existing[project_id] = proj_obj
    existing['last_update'] = now

    admin_svc.save_config_raw('area_plan_map', existing)

    return {
        'ok': True,
        'project_id': project_id,
        'area_path': area_path,
        'plans': new_plans,
        'last_update': now,
    }


def refresh_all(pat: str, azure_client, admin_svc) -> dict:
    """Refresh mappings for all configured area paths, persist and return results.

    Parameters mirror :func:`refresh_single` except no ``area_path`` argument.
    """
    if not pat:
        raise ValueError('A PAT is required to query Azure for mappings')

    project_map: list = admin_svc.get_project_map() or []
    existing: dict = admin_svc.get_config('area_plan_map') or {}

    with azure_client.connect(pat) as client:
        # Cache plans per Azure project to avoid redundant API calls
        project_plans: dict = {}
        for entry in project_map:
            area = entry.get('area_path')
            if not area:
                continue
            proj_name = area.split('\\')[0] if '\\' in area else area.split('/')[0]
            if proj_name not in project_plans:
                try:
                    plans = client.get_all_plans(proj_name)  # type: ignore
                    project_plans[proj_name] = plans
                    logger.info("Fetched %d plans for %s", len(plans), proj_name)
                except Exception as e:
                    logger.warning("Failed to fetch plans for %s: %s", proj_name, e)
                    project_plans[proj_name] = []

        results: dict = {}
        for entry in project_map:
            area = entry.get('area_path')
            proj_id = entry.get('id')
            if not area or not proj_id:
                continue

            proj_name = area.split('\\')[0] if '\\' in area else area.split('/')[0]
            all_plans = project_plans.get(proj_name, [])

            try:
                owner_team_ids = client.get_team_from_area_path(proj_name, area)  # type: ignore
            except Exception as e:
                results[area] = {'ok': False, 'error': str(e)}
                continue

            matched: dict = {
                str(plan['id']): plan['name']
                for plan in all_plans
                if any(t.get('id') in owner_team_ids for t in plan.get('teams', []))
            }
            logger.info("Area %s: found %d teams, matched %d plans", area, len(owner_team_ids), len(matched))

            old_plans = existing.get(proj_id, {}).get('areas', {}).get(area, {}).get('plans', {})
            new_plans = _merge_plans(matched, old_plans)

            results[area] = {'ok': True, 'plans': new_plans, 'project_id': proj_id}
            existing.setdefault(proj_id, {}).setdefault('areas', {})[area] = {'plans': new_plans}

    existing['last_update'] = datetime.now(timezone.utc).isoformat()
    admin_svc.save_config_raw('area_plan_map', existing)

    return {'ok': True, 'results': results}


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _find_project_id(area_path: str, project_name: str, project_map: list, slugify) -> str | None:
    """Return the configured project id that owns *area_path*, or ``None``."""
    for p in project_map:
        try:
            cfg_area = p.get('area_path')
            if not cfg_area:
                continue
            if (
                area_path == cfg_area
                or area_path.startswith(cfg_area + '\\')
                or cfg_area.startswith(area_path + '\\')
            ):
                return p.get('id')
        except Exception:
            continue
    # Fallback: slugified root match
    for p in project_map:
        try:
            if slugify(p.get('name', ''), prefix='project-') == slugify(project_name, prefix='project-'):
                return p.get('id')
        except Exception:
            continue
    return None


def _merge_plans(new_plan_dict: dict, old_plans: Any) -> dict:
    """Merge new plan ids/names with existing enabled states.

    New plans default to ``enabled=True``; existing plans preserve their flag.
    """
    if not isinstance(old_plans, dict):
        old_plans = {}
    result = {}
    for pid, pname in new_plan_dict.items():
        if pid in old_plans:
            result[pid] = {'name': pname, 'enabled': old_plans[pid].get('enabled', True)}
        else:
            result[pid] = {'name': pname, 'enabled': True}
    return result
