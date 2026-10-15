from datetime import datetime
from typing import Optional, Dict, Any
from planner_lib.domain.teams import TeamCatalogue
from planner_lib.domain.workforce import WorkforceCatalogue
from .allocation_rule import expand_group_allocations, has_valid_allocation_span


def calculate_workforce_detailed(
    teams: TeamCatalogue, workforce: WorkforceCatalogue,
    start: str | None, end: str | None, capacity: list[dict[str, Any]],
) -> dict[str, Any]:
    """Price resolved anonymous reservations without people, sites or a combined charged total."""
    definitions = teams.definitions()
    memberships = {
        item['id']: item['group_id'] for item in definitions
        if item['kind'] == 'team' and item['group_id'] is not None
    }
    group_ids = [item['id'] for item in definitions if item['kind'] == 'group']
    expanded = expand_group_allocations({'item': capacity}, memberships, group_ids)['item']
    bases = workforce.team_bases()
    result: dict[str, Any] = {
        'internal_cost': 0.0, 'external_cost': 0.0,
        'internal_hours': 0.0, 'external_hours': 0.0,
        'teams': {}, 'missing_basis': [], 'complete': True,
    }
    dated = has_valid_allocation_span({'start': start, 'end': end})
    for allocation in expanded:
        identity = allocation['team']
        if identity not in bases:
            result['missing_basis'].append(dict(allocation))
            result['complete'] = False
            continue
        if identity in result['teams']:
            raise ValueError(f'Overlapping resolved allocation basis: {identity}')
        basis = bases[identity]
        percentage = allocation['capacity'] / 100
        entry: dict[str, Any] = {
            'cost': {'internal': {}, 'external': {}},
            'hours': {'internal': {}, 'external': {}},
            'profiles': [],
        }
        for account in ('internal', 'external'):
            account_basis = basis[account]
            monthly_hours = account_basis['monthly_hours']
            buckets = _allocate_months(start, end, monthly_hours) if dated and monthly_hours > 0 else {}
            fractions = {month: hours / monthly_hours for month, hours in buckets.items()}
            for month, hours in buckets.items():
                allocated_hours = round(hours * percentage, 2)
                cost = round(account_basis['monthly_cost'] * fractions[month] * percentage, 2)
                entry['hours'][account][month] = allocated_hours
                entry['cost'][account][month] = cost
                result[f'{account}_hours'] += allocated_hours
                result[f'{account}_cost'] += cost
            for profile in basis['profiles']:
                if profile['external'] != (account == 'external'):
                    continue
                entry['profiles'].append({
                    'supplier_id': profile['supplier_id'], 'profile_id': profile['profile_id'],
                    'external': profile['external'], 'fte': profile['fte'],
                    'hours': {month: round(profile['monthly_hours'] * fraction * percentage, 2)
                              for month, fraction in fractions.items()},
                    'cost': {month: round(profile['monthly_cost'] * fraction * percentage, 2)
                             for month, fraction in fractions.items()},
                })
        result['teams'][identity] = entry
    for account in ('internal', 'external'):
        for metric in ('hours', 'cost'):
            result[f'{account}_{metric}'] = round(result[f'{account}_{metric}'], 2)
    return result


def _allocate_months(start: Optional[str], end: Optional[str], default_hours_per_month: float) -> Dict[str, float]:
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

    if not start or not end:
        return {}

    try:
        s = datetime.fromisoformat(start).date()
        e = datetime.fromisoformat(end).date()
    except ValueError:
        return {}

    if e < s:
        return {}

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
