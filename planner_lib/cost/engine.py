from datetime import datetime
from typing import Optional, List, Dict, Any
from planner_lib.util import slugify
from planner_lib.storage.base import StorageBackend
import logging

logger = logging.getLogger(__name__)


def invalidate_team_rates_cache(cache_storage: StorageBackend) -> None:
    """Clear the team aggregates cache.

    Call this after changing configuration files or during tests to force
    recomputation of team aggregates on next calculation.
    
    Args:
        cache_storage: Storage backend for the cache. Clears the 'team_rates'
                      entry in the 'cost_cache' namespace.
    """
    try:
        if cache_storage.exists('cost_cache', 'team_rates'):
            cache_storage.delete('cost_cache', 'team_rates')
            logger.debug("Team rates cache invalidated via storage")
        else:
            logger.debug("Team rates cache already empty")
    except Exception as e:
        logger.warning("Failed to invalidate team rates cache: %s", e)

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

def _team_members(config: Dict[str, Any], cache_storage: StorageBackend) -> Dict[str, Dict[str, Any]]:
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
    
    Args:
        config: Configuration dict containing database and cost settings
        cache_storage: Storage backend for caching results
    """
    # Try to load from cache
    if cache_storage.exists('cost_cache', 'team_rates'):
        return cache_storage.load('cost_cache', 'team_rates')
    else:
        logger.debug("Team rates cache miss, will compute")
    
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
            "sites": {},
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
            # Accumulate per-person monthly cost: sum(rate_i * hours_i) is correct.
            # Do NOT compute as sum(rates) * sum(hours) — that gives N^2 scaling.
            entry.setdefault("external_monthly_cost_total", 0.0)
            entry["external_monthly_cost_total"] += rate_val * hrs
            # maintain per-site hourly totals so we can compute site monthly costs
            # maintain per-site aggregates for this team
            site_entry = entry['sites'].setdefault(site, {
                'internal_count': 0,
                'internal_hours_total': 0.0,
                'internal_monthly_cost_total': 0.0,
                'external_count': 0,
                'external_hours_total': 0.0,
                'external_monthly_cost_total': 0.0,
                'external_hourly_rate_total': 0.0,
            })
            site_entry['external_count'] += 1
            site_entry['external_hours_total'] += hrs
            site_entry['external_hourly_rate_total'] = site_entry.get('external_hourly_rate_total', 0.0) + rate_val
            site_entry['external_monthly_cost_total'] += rate_val * hrs
        else:
            entry["internal_count"] += 1
            rate_val = float(cost_cfg.get("internal_cost", {}).get("default_hourly_rate", 0) or 0)
            hrs = int(site_hours_map.get(site, {}).get("internal", 0))
            entry["internal_hourly_rate_total"] += rate_val
            entry["internal_hours_total"] += hrs
            # Accumulate per-person monthly cost: sum(rate_i * hours_i) is correct.
            # Do NOT compute as sum(rates) * sum(hours) — that gives N^2 scaling.
            entry.setdefault("internal_monthly_cost_total", 0.0)
            entry["internal_monthly_cost_total"] += rate_val * hrs
            # maintain per-site aggregates for this team
            site_entry = entry['sites'].setdefault(site, {
                'internal_count': 0,
                'internal_hours_total': 0.0,
                'internal_monthly_cost_total': 0.0,
                'internal_hourly_rate_total': 0.0,
                'external_count': 0,
                'external_hours_total': 0.0,
                'external_monthly_cost_total': 0.0,
            })
            site_entry['internal_count'] += 1
            site_entry['internal_hours_total'] += hrs
            site_entry['internal_hourly_rate_total'] = site_entry.get('internal_hourly_rate_total', 0.0) + rate_val
            site_entry['internal_monthly_cost_total'] += rate_val * hrs
    
    # Round already-accumulated per-person cost sums.
    # monthly_cost was built as sum(rate_i * hours_i) during the loop above,
    # which is the correct linear formula. Do NOT recompute here as
    # sum(rates) * sum(hours) — that formula gives N^2 scaling for N members.
    for team_key, entry in res.items():
        try:
            entry['internal_monthly_cost_total'] = round(entry.get('internal_monthly_cost_total', 0.0), 2)
            entry['external_monthly_cost_total'] = round(entry.get('external_monthly_cost_total', 0.0), 2)

            sites = entry.get('sites', {}) or {}
            for site_key, sv in sites.items():
                sv['internal_monthly_cost_total'] = round(sv.get('internal_monthly_cost_total', 0.0), 2)
                sv['external_monthly_cost_total'] = round(sv.get('external_monthly_cost_total', 0.0), 2)
        except Exception:
            # if anything goes wrong, leave existing values as-is
            logger.debug("Failed to round monthly costs for team %s", team_key)

    # Cache the result
    try:
        cache_storage.save('cost_cache', 'team_rates', res)
        logger.debug("Cached team rates for %d teams", len(res))
    except Exception as e:
        logger.warning("Failed to cache team rates: %s", e)
    
    return res

def calculate(config: Dict[str, Any], start: Optional[str], end: Optional[str], capacity: list[Dict[str, float]], cache_storage: StorageBackend) -> Dict[str, Any]:
    """Calculate costs for a single task given a company config and task profile.

    Args:
      config: dict with keys 'cost' and 'database').
      start/end: ISO date strings.
      capacity: list of team allocations [{"team": "team-name", "capacity": 80}, ...]
      cache_storage: Storage backend for caching team aggregates.

    Returns a dict: { 'internal_cost', 'external_cost', 'internal_hours', 'external_hours' }
    """
    #logger.debug(config)

    # Get team aggregates, this contains the available hours and cost per month for a team.
    team_aggregates = _team_members(config, cache_storage=cache_storage)
    logger.debug("Team aggregates: %s", team_aggregates)

    # The capacity is a [{"team": p, "capacity": c}, ...]
    # Handle None or non-list capacity gracefully
    if not isinstance(capacity, list):
        capacity = []
    
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
            internal_cost_local = round(team_monthly_cost_internal * (team["capacity"] / 100.0) * fraction_internal, 2)
            entry["internal_cost"] += internal_cost_local
            logger.debug("[INSTR][engine] team=%s cap=%s base_hours_int=%.2f alloc_hours_int=%.2f internal_cost=%.2f sites=%s", team["team"], team.get("capacity"), base_hours_internal, alloc_hours_internal, internal_cost_local, team_summary.get('sites'))
        if team_summary.get("external_hours_total"):
            base_hours_external = _hours_between(start, end, team_summary["external_hours_total"])
            alloc_hours_external = round(base_hours_external * team["capacity"] / 100, 2)
            entry["external_hours"] += alloc_hours_external
            fraction_external = base_hours_external / max(1.0, float(team_summary["external_hours_total"]))
            team_monthly_cost_external = float(team_summary.get("external_monthly_cost_total", 0.0))
            external_cost_local = round(team_monthly_cost_external * (team["capacity"] / 100.0) * fraction_external, 2)
            entry["external_cost"] += external_cost_local
            logger.debug("[INSTR][engine] team=%s cap=%s base_hours_ext=%.2f alloc_hours_ext=%.2f external_cost=%.2f sites=%s", team["team"], team.get("capacity"), base_hours_external, alloc_hours_external, external_cost_local, team_summary.get('sites'))
        #logger.debug("Team '%s' default hours per month: internal %s, external %s", team["team"], team_summary["internal_hours_total"], team_summary["external_hours_total"])
        #logger.debug("Team '%s' task hours: internal %.2f, external %.2f", team["team"], entry["internal_hours"], entry["external_hours"])
        #logger.debug("Team '%s' task costs: internal %.2f, external %.2f", team["team"], entry["internal_cost"], entry["external_cost"])
    return entry


def calculate_detailed(config: Dict[str, Any], start: Optional[str], end: Optional[str], capacity: list[Dict[str, float]], cache_storage: StorageBackend) -> Dict[str, Any]:
    """Calculate costs for a single task and return detailed per-team, per-month allocations.

    Returns dict with overall totals plus a `teams` mapping containing per-team
    month buckets for `hours` and `cost`, site breakdowns, and team totals.
    """
    team_aggregates = _team_members(config, cache_storage=cache_storage)

    # Ensure capacity is a list
    if not isinstance(capacity, list):
        capacity = []

    teams_out: Dict[str, Any] = {}
    totals = {
        "internal_cost": 0.0,
        "external_cost": 0.0,
        "internal_hours": 0.0,
        "external_hours": 0.0,
    }

    for team in (capacity or []):
        team_key = team.get("team")
        try:
            cap_pct = float(team.get("capacity", 0)) / 100.0
        except Exception:
            cap_pct = 0.0
        if not team_key or team_key not in team_aggregates:
            continue
        summary = team_aggregates[team_key]

        team_entry: Dict[str, Any] = {
            "cost": {"internal": {}, "external": {}},
            "hours": {"internal": {}, "external": {}},
            "totalCost": 0.0,
            "totalHours": 0.0,
            "sites": {}
        }

        # Internal allocations
        if summary.get("internal_hours_total"):
            month_buckets = _allocate_months(start, end, int(summary.get("internal_hours_total") or 0))
            team_monthly_cost_internal = float(summary.get("internal_monthly_cost_total", 0.0))
            denom = float(summary.get("internal_hours_total") or 1)
            for m_k, base_hours in (month_buckets or {}).items():
                alloc_hours = round(base_hours * cap_pct, 2)
                team_entry["hours"]["internal"][m_k] = alloc_hours
                fraction = base_hours / max(1.0, denom)
                cost_val = round(team_monthly_cost_internal * cap_pct * fraction, 2)
                team_entry["cost"]["internal"][m_k] = cost_val
                team_entry["totalCost"] += cost_val
                team_entry["totalHours"] += alloc_hours

            # per-site breakdown for internal
            sites_info = summary.get("sites", {}) or {}
            denom_sites = sum((sv.get("internal_hours_total", 0) or 0) for sv in sites_info.values()) or float(summary.get("internal_hours_total") or 1)
            for m_k, base_hours in (month_buckets or {}).items():
                alloc_hours_team = base_hours * cap_pct
                for site, sv in sites_info.items():
                    site_hours_share = (sv.get("internal_hours_total", 0) or 0) / denom_sites if denom_sites else 0
                    site_hours = round(alloc_hours_team * site_hours_share, 2)
                    if sv.get("internal_hours_total"):
                        site_cost_per_hour = float(sv.get("internal_monthly_cost_total", 0.0)) / max(1.0, float(sv.get("internal_hours_total") or 1))
                    else:
                        site_cost_per_hour = float(summary.get("internal_monthly_cost_total", 0.0)) / max(1.0, float(summary.get("internal_hours_total") or 1))
                    site_cost = round(site_hours * site_cost_per_hour, 2)
                    site_entry = team_entry["sites"].setdefault(site, {"hours": {}, "cost": {}})
                    site_entry["hours"][m_k] = site_entry["hours"].get(m_k, 0.0) + site_hours
                    site_entry["cost"][m_k] = site_entry["cost"].get(m_k, 0.0) + site_cost

            totals["internal_cost"] += team_entry["totalCost"]
            totals["internal_hours"] += team_entry["totalHours"]

        # External allocations
        if summary.get("external_hours_total"):
            month_buckets_ext = _allocate_months(start, end, int(summary.get("external_hours_total") or 0))
            team_monthly_cost_external = float(summary.get("external_monthly_cost_total", 0.0))
            denom_ext = float(summary.get("external_hours_total") or 1)
            for m_k, base_hours in (month_buckets_ext or {}).items():
                alloc_hours = round(base_hours * cap_pct, 2)
                team_entry["hours"]["external"][m_k] = alloc_hours
                fraction = base_hours / max(1.0, denom_ext)
                cost_val = round(team_monthly_cost_external * cap_pct * fraction, 2)
                team_entry["cost"]["external"][m_k] = cost_val
                team_entry["totalCost"] += cost_val
                team_entry["totalHours"] += alloc_hours

            # external site breakdown
            sites_info = summary.get("sites", {}) or {}
            denom_sites_ext = sum((sv.get("external_hours_total", 0) or 0) for sv in sites_info.values()) or float(summary.get("external_hours_total") or 1)
            for m_k, base_hours in (month_buckets_ext or {}).items():
                alloc_hours_team = base_hours * cap_pct
                for site, sv in sites_info.items():
                    site_hours_share = (sv.get("external_hours_total", 0) or 0) / denom_sites_ext if denom_sites_ext else 0
                    site_hours = round(alloc_hours_team * site_hours_share, 2)
                    if sv.get("external_hours_total"):
                        site_cost_per_hour = float(sv.get("external_monthly_cost_total", 0.0)) / max(1.0, float(sv.get("external_hours_total") or 1))
                    else:
                        site_cost_per_hour = float(summary.get("external_monthly_cost_total", 0.0)) / max(1.0, float(summary.get("external_hours_total") or 1))
                    site_cost = round(site_hours * site_cost_per_hour, 2)
                    site_entry = team_entry["sites"].setdefault(site, {"hours": {}, "cost": {}})
                    site_entry["hours"][m_k] = site_entry["hours"].get(m_k, 0.0) + site_hours
                    site_entry["cost"][m_k] = site_entry["cost"].get(m_k, 0.0) + site_cost

            totals["external_cost"] += team_entry["totalCost"] - team_entry.get("totalCost", 0.0) + 0.0
            totals["external_hours"] += 0.0

        teams_out[team_key] = team_entry

    # Compute overall sums more robustly
    overall_internal_cost = 0.0
    overall_external_cost = 0.0
    overall_internal_hours = 0.0
    overall_external_hours = 0.0
    for t in teams_out.values():
        # sum costs split by internal/external from months
        for v in t.get("cost", {}).get("internal", {}).values():
            overall_internal_cost += float(v or 0)
        for v in t.get("cost", {}).get("external", {}).values():
            overall_external_cost += float(v or 0)
        for v in t.get("hours", {}).get("internal", {}).values():
            overall_internal_hours += float(v or 0)
        for v in t.get("hours", {}).get("external", {}).values():
            overall_external_hours += float(v or 0)

    return {
        "internal_cost": round(overall_internal_cost, 2),
        "external_cost": round(overall_external_cost, 2),
        "internal_hours": round(overall_internal_hours, 2),
        "external_hours": round(overall_external_hours, 2),
        "teams": teams_out,
    }


def _allocate_months(start: Optional[str], end: Optional[str], default_hours_per_month: int) -> Dict[str, float]:
    """Allocate hours into month buckets (YYYY-MM) for the span from start to end.

    Returns a mapping { 'YYYY-MM': hours } where the hours are scaled from
    `default_hours_per_month` using working-day fractions within each month.
    """
    from datetime import date, timedelta
    import calendar

    # Average working days per month used elsewhere
    avg_working_days_per_month = 5 * 52.0 / 12.0

    def month_key(d: date) -> str:
        return f"{d.year:04d}-{d.month:02d}"

    # If no start/end, allocate a single month worth of hours to a generic key
    if not start or not end:
        # Use current month as key
        today = datetime.now().date()
        return { month_key(today): float(default_hours_per_month) }

    try:
        s = datetime.fromisoformat(start).date()
        e = datetime.fromisoformat(end).date()
    except Exception:
        today = datetime.now().date()
        return { month_key(today): float(default_hours_per_month) }

    if e < s:
        s, e = e, s

    # Iterate months between s and e inclusive
    cur_year = s.year
    cur_month = s.month
    out: Dict[str, float] = {}
    while True:
        # month start and end
        month_start = date(cur_year, cur_month, 1)
        last_day = calendar.monthrange(cur_year, cur_month)[1]
        month_end = date(cur_year, cur_month, last_day)

        # compute overlap range
        seg_start = s if s > month_start else month_start
        seg_end = e if e < month_end else month_end

        # count working days in segment
        days = (seg_end - seg_start).days + 1
        working = 0
        for i in range(days):
            if (seg_start + timedelta(days=i)).weekday() < 5:
                working += 1

        hours = (working / avg_working_days_per_month) * float(default_hours_per_month) if avg_working_days_per_month else float(default_hours_per_month)
        out[month_key(seg_start)] = round(hours, 2)

        # advance month
        if cur_year == e.year and cur_month == e.month:
            break
        if cur_month == 12:
            cur_month = 1
            cur_year += 1
        else:
            cur_month += 1

    return out
