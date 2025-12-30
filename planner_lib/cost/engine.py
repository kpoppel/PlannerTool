from datetime import datetime
from typing import Optional, List, Dict, Any
from planner_lib.util import slugify
import logging

logger = logging.getLogger(__name__)
team_rates_cache: Dict[str, Dict[str, Any]] | None = None


def invalidate_team_rates_cache() -> None:
    """Clear the in-memory team aggregates cache.

    Call this after changing configuration files or during tests to force
    recomputation of team aggregates on next calculation.
    """
    global team_rates_cache
    team_rates_cache = None
    logger.debug("Team rates cache invalidated")

def _hours_between(start: Optional[str], end: Optional[str], default_hours_per_month: int) -> float:
    """ Calculate working hours between two ISO date strings.
        Uses average 52 weeks / 12 months == 4.333... weeks per month
        and computes the working-day fraction of a month to scale the
        provided `default_hours_per_month` (which represents total available
        hours for the team or role in a typical month).
    """
    # Average working days per month (5 working days per week * 52 weeks / 12 months)
    avg_working_days_per_month = 5 * 52.0 / 12.0  # ~= 21.6667
    try:
        if not start or not end:
            # return a single-month worth of hours
            return float(default_hours_per_month)
        s = datetime.fromisoformat(start)
        e = datetime.fromisoformat(end)
        total_days = (e - s).days + 1
        full_weeks, rem = divmod(total_days, 7)
        start_wd = s.weekday()
        extra = 0
        for i in range(rem):
            if (start_wd + i) % 7 < 5:  # 0-4 are Mon-Fri
                extra += 1
        working_days = full_weeks * 5 + extra
        working_days = max(0, working_days)
        # Scale the default monthly hours by the fraction of working days covered
        return (working_days / avg_working_days_per_month) * float(default_hours_per_month)
    except Exception:
        return float(default_hours_per_month)

def _team_members(config: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Return aggregated team information.

    Returns a mapping: {
      <team_name>: {
         'internal_count': int,
         'internal_hourly_rate_total': float,  # sum of internal hourly rates (uses default when missing)
         'internal_hours_total': float,         # sum of internal permanent hours
         'external_count': int,
         'external_hourly_rate_total': float,  # sum of external hourly rates
         'external_hours_total': float,         # sum of external permanent hours
      }, ... }
    """
    global team_rates_cache
    if team_rates_cache is not None:
        return team_rates_cache
    res: Dict[str, Dict[str, Any]] = {}
    db_cfg = (config or {}).get("database", {})
    people = db_cfg.get("people", []) or []
    cost_cfg = (config or {}).get("cost", {})

    # Expect `working_hours` to be a mapping: { site: { internal: N, external: M }, ... }
    site_hours_map: Dict[str, Dict[str, Any]] = cost_cfg.get("working_hours", {}) or {}
    # external_cost.external expected as mapping name->rate
    external_cfg = cost_cfg.get("external_cost", {}) or {}
    ext_rates: Dict[str, Any] = external_cfg.get("external", {}) or {}
    default_ext_rate = external_cfg.get("default_hourly_rate", 0)

    # Aggregate by team_name key present in people entries
    for p in people:
        # Normalize team identifiers to the canonical frontend id format 'team-<slug>'.
        # Use slugify without a prefix to avoid doubling 'team-' when the
        # original name already contains the word 'Team'. Then ensure the
        # final id starts with 'team-'.
        raw = p.get("team_name") or p.get("team") or ""
        base = slugify(raw)
        team = base if base.startswith("team-") else f"team-{base}"
        if not team:
            continue
        site = p.get("site") or ""
        is_external = bool(p.get("external"))

        entry = res.setdefault(team, {
            "internal_count": 0,
            "internal_hourly_rate_total": 0.0,
            "internal_hours_total": 0.0,
            "external_count": 0,
            "external_hourly_rate_total": 0.0,
            "external_hours_total": 0.0,
        })

        if is_external:
            entry["external_count"] += 1
            name = p.get("name")
            rate = ext_rates.get(name, default_ext_rate)
            logger.debug("Looking up external rate for '%s': %s", name, rate)
            rate_val = float(rate or 0)
            hrs = int(site_hours_map.get(site, {}).get("external", 0))
            entry["external_hourly_rate_total"] += rate_val
            entry["external_hours_total"] += hrs
            entry.setdefault("external_monthly_cost_total", 0.0)
            entry["external_monthly_cost_total"] += rate_val * hrs
        else:
            entry["internal_count"] += 1
            rate_val = float(cost_cfg.get("internal_cost", {}).get("default_hourly_rate", 0) or 0)
            hrs = int(site_hours_map.get(site, {}).get("internal", 0))
            entry["internal_hourly_rate_total"] += rate_val
            entry["internal_hours_total"] += hrs
            entry.setdefault("internal_monthly_cost_total", 0.0)
            entry["internal_monthly_cost_total"] += rate_val * hrs
    # logger.debug("Computed team aggregates for %d teams", len(res))
    # logger.debug(res)
    team_rates_cache = res
    return res

def calculate(config: Dict[str, Any], start: Optional[str], end: Optional[str], capacity: list[Dict[str, float]]) -> Dict[str, Any]:
    """Calculate costs for a single task given a company config and task profile.

    Args:
      config: dict with keys 'cost' and 'database' (as returned by load_cost_config()).
      start/end: ISO date strings.
      capacity: fraction of full-time (0.0-1.0+).
      team: team name to lookup internal members in config['database']['teams'].

    Returns a dict: { 'internal_cost', 'external_cost', 'internal_hours', 'external_hours' }
    """
    #logger.debug(config)

    # Get team aggregates, this contains the available hours and cost per month for a team.
    team_aggregates = _team_members(config)
    logger.debug("Team aggregates: %s", team_aggregates)

    # The capacity is a [{"team": p, "capacity": c}, ...]
    # Run through all teams and sum up their costs/hours
    entry = {
        "internal_cost": 0.0,
        "internal_hours": 0.0,
        "external_cost": 0.0,
        "external_hours": 0.0,
    }
    for team in capacity:
        #logger.debug("Calculating costs for team '%s' with capacity %s", team["team"], team["capacity"])
        if team["team"] not in team_aggregates:
            logger.error("No team aggregate data for team '%s'", team["team"])
            continue
        team_summary = team_aggregates[team["team"]]
        #logger.debug("Team summary for '%s': %s", team["team"], team_summary)
        # Calculate estimated cost and hours spent by this team on the task.
        # Use a monthly-cost-based approach to avoid double-counting when a
        # team contains multiple members. Compute the fraction of a month the
        # span covers (derived from _hours_between) and scale the team's
        # monthly cost by that fraction and by the requested capacity percent.
        if team_summary.get("internal_hours_total"):
            base_hours_internal = _hours_between(start, end, team_summary["internal_hours_total"])
            # hours allocated to the task (scaled by capacity percent)
            alloc_hours_internal = round(base_hours_internal * team["capacity"] / 100, 2)
            entry["internal_hours"] += alloc_hours_internal
            # fraction of a typical month covered by the span
            fraction_internal = base_hours_internal / max(1.0, float(team_summary["internal_hours_total"]))
            team_monthly_cost_internal = float(team_summary.get("internal_monthly_cost_total", 0.0))
            entry["internal_cost"] += round(team_monthly_cost_internal * (team["capacity"] / 100.0) * fraction_internal, 2)
        if team_summary.get("external_hours_total"):
            base_hours_external = _hours_between(start, end, team_summary["external_hours_total"])
            alloc_hours_external = round(base_hours_external * team["capacity"] / 100, 2)
            entry["external_hours"] += alloc_hours_external
            fraction_external = base_hours_external / max(1.0, float(team_summary["external_hours_total"]))
            team_monthly_cost_external = float(team_summary.get("external_monthly_cost_total", 0.0))
            entry["external_cost"] += round(team_monthly_cost_external * (team["capacity"] / 100.0) * fraction_external, 2)
        #logger.debug("Team '%s' default hours per month: internal %s, external %s", team["team"], team_summary["internal_hours_total"], team_summary["external_hours_total"])
        #logger.debug("Team '%s' task hours: internal %.2f, external %.2f", team["team"], entry["internal_hours"], entry["external_hours"])
        #logger.debug("Team '%s' task costs: internal %.2f, external %.2f", team["team"], entry["internal_cost"], entry["external_cost"])
    return entry
