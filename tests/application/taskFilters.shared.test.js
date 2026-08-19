import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_FILTERS,
  getAllTaskFiltersEnabled,
  normalizeTaskFilters,
} from '../../www/js/application/shared/taskFilters.js';

describe('application/shared/taskFilters', () => {
  it('normalizes partial task filters to the canonical dimensions/options', () => {
    const normalized = normalizeTaskFilters({
      schedule: { planned: false },
      allocation: { unallocated: false },
    });

    expect(normalized).toEqual({
      schedule: { planned: false, unplanned: true },
      allocation: { allocated: true, unallocated: false },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true },
    });
  });

  it('returns a fresh canonical all-enabled filter object', () => {
    const first = getAllTaskFiltersEnabled();
    const second = getAllTaskFiltersEnabled();

    expect(first).toEqual(DEFAULT_TASK_FILTERS);
    expect(second).toEqual(DEFAULT_TASK_FILTERS);
    expect(first).not.toBe(second);
    expect(first.schedule).not.toBe(second.schedule);
  });
});
