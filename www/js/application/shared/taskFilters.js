export const DEFAULT_TASK_FILTERS = {
  schedule: { planned: true, unplanned: true },
  allocation: { allocated: true, unallocated: true },
  hierarchy: { hasParent: true, noParent: true },
  relations: { hasLinks: true, noLinks: true },
};

export function normalizeTaskFilters(filters) {
  const next = {};

  for (const [dimension, options] of Object.entries(DEFAULT_TASK_FILTERS)) {
    next[dimension] = {
      ...options,
      ...filters[dimension],
    };
  }

  return next;
}

export function getAllTaskFiltersEnabled() {
  return normalizeTaskFilters(DEFAULT_TASK_FILTERS);
}
