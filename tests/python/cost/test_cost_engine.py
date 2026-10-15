import pytest
from planner_lib.cost import engine


@pytest.mark.parametrize('start,end', [
    (None, None), (None, '2025-01-01'), ('2025-01-01', None),
    ('invalid', '2025-01-01'), ('2025-02-30', '2025-03-01'),
    ('2025-02-01', '2025-01-01'),
])
def test_undated_or_invalid_spans_contribute_zero(start, end):
    assert engine._allocate_months(start, end, 160) == {}


def test_allocate_months_full_month():
    # Full March 2026 -> expect one month key and hours close to default
    default = 160
    res = engine._allocate_months('2026-03-01', '2026-03-31', default)
    assert res == {'2026-03': 162.46}
