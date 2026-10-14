/**
 * PluginCostCalculator
 * Pure utility functions for cost analysis calculations in PluginCost.
 *
 * Provides:
 * - Dataset expansion via parent/child relations
 * - Task tree building (orphans vs parents-with-children)
 * - UTC date/month helpers and day-overlap allocations
 *
 * All functions are pure, side-effect free, and throw on invalid data
 * for explicit error handling (no silent failures).
 */

import { hasValidAllocationSpan } from '../application/shared/allocationRule.js';

/**
 * Parse an ISO date-only string into a Date in UTC at midnight.
 * @param {string|Date|null} date
 * @returns {Date|null}
 */
export const toDate = (date) => {
  if (!date) return null;
  if (date instanceof Date) return date;
  return new Date(`${date}T00:00:00Z`);
};

/**
 * Return UTC midnight on the first day of the month.
 * @param {Date|null} date
 * @returns {Date|null}
 */
export const firstOfMonth = (date) => {
  if (!date) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
};

/**
 * Return UTC midnight on the last day of the month.
 * @param {Date|null} date
 * @returns {Date|null}
 */
export const lastOfMonth = (date) => {
  if (!date) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
};

/**
 * Add months and return the first day of the resulting month in UTC.
 * @param {Date} date
 * @param {number} count
 * @returns {Date}
 */
export const addMonths = (date, count) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));

/**
 * Create a stable YYYY-MM key using UTC month/year.
 * @param {Date} date
 * @returns {string}
 */
export const monthKey = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Create a human-friendly month label for table headers.
 * @param {Date} date
 * @returns {string}
 */
export const monthLabel = (date) =>
  date.toLocaleString(undefined, { month: 'short', year: 'numeric' });

/**
 * Build an inclusive month range using UTC-first-of-month dates.
 * @param {{dataset_start: string|Date|null, dataset_end: string|Date|null}} config
 * @returns {Date[]}
 */
export const buildMonths = ({ dataset_start, dataset_end }) => {
  const start = firstOfMonth(toDate(dataset_start));
  const end = firstOfMonth(toDate(dataset_end));
  if (!start || !end) return [];
  const months = [];
  for (let current = start; current <= end; current = addMonths(current, 1)) {
    months.push(new Date(current));
  }
  return months;
};

/**
 * Expand a feature dataset to include all descendants via parent/child relations.
 *
 * Given a set of features and a childrenByParent map, returns a new array
 * containing the input features plus all their children (recursively).
 * Prevents duplicates by tracking visited IDs.
 *
 * @param {Array<Object>} features - Initial feature set
 * @param {Map<string|number, Array<string|number>>} childrenByParent - Parent->children mapping
 * @param {Array<Object>} allFeatures - Complete feature list to lookup children
 * @returns {Array<Object>} Expanded feature set including all descendants
 * @throws {Error} If childrenByParent is not a Map or allFeatures is not an array
 */
export function expandDataset(features, childrenByParent, allFeatures) {
  if (!Array.isArray(features)) {
    throw new Error('expandDataset: features must be an array');
  }
  if (!(childrenByParent instanceof Map)) {
    throw new Error('expandDataset: childrenByParent must be a Map');
  }
  if (!Array.isArray(allFeatures)) {
    throw new Error('expandDataset: allFeatures must be an array');
  }

  const visited = new Set();
  const result = [];
  const featureMap = new Map(allFeatures.map((f) => [String(f.id), f]));

  function addWithChildren(featureId) {
    const fid = String(featureId);
    if (visited.has(fid)) return;
    visited.add(fid);

    const feature = featureMap.get(fid);
    if (!feature) return; // Feature not in full list

    result.push(feature);

    // Add children recursively
    const children = childrenByParent.get(Number(fid)) || childrenByParent.get(fid) || [];
    for (const childId of children) {
      addWithChildren(childId);
    }
  }

  for (const f of features) {
    addWithChildren(f.id);
  }

  return result;
}

/**
 * Build a task tree structure identifying orphans and parent-child relationships.
 *
 * Returns:
 * - roots: array of feature IDs that have no parent (orphans) or are top-level parents
 * - childrenMap: Map of parentId -> [childIds...]
 * - parentMap: Map of childId -> parentId
 *
 * @param {Array<Object>} features - Feature list
 * @param {Map<string|number, Array<string|number>>} childrenByParent - Parent->children mapping
 * @returns {{roots: Array<string>, childrenMap: Map<string, Array<string>>, parentMap: Map<string, string>}}
 * @throws {Error} If features is not an array or childrenByParent is not a Map
 */
export function buildTaskTree(features, childrenByParent) {
  if (!Array.isArray(features)) {
    throw new Error('buildTaskTree: features must be an array');
  }
  if (!(childrenByParent instanceof Map)) {
    throw new Error('buildTaskTree: childrenByParent must be a Map');
  }

  const childrenMap = new Map();
  const parentMap = new Map();
  const allIds = new Set(features.map((f) => String(f.id)));

  // Build childrenMap and parentMap from childrenByParent
  for (const f of features) {
    const fid = String(f.id);
    const children = childrenByParent.get(Number(f.id)) || childrenByParent.get(fid) || [];

    // Filter to only include children that exist in our feature set
    const validChildren = children.filter((cid) => allIds.has(String(cid)));

    if (validChildren.length > 0) {
      childrenMap.set(fid, validChildren.map(String));
      for (const childId of validChildren) {
        parentMap.set(String(childId), fid);
      }
    }
  }

  // Identify roots: features without parents or not in parentMap
  const roots = features
    .filter((f) => !parentMap.has(String(f.id)))
    .map((f) => String(f.id));

  return { roots, childrenMap, parentMap };
}

/**
 * Allocate feature cost/hours to months based on date overlap.
 *
 * Distributes values proportionally across months based on overlapping days.
 *
 * @param {Object} feature - Feature with start, end, metrics
 * @param {Array<Date>} months - Array of month start dates (UTC)
 * @returns {{cost: {internal: Map, external: Map}, hours: {internal: Map, external: Map}}}
 *   Maps monthKey -> value for each month
 * @throws {Error} If feature or months have invalid structure
 */
export function allocateToMonths(feature, months) {
  if (!feature || typeof feature !== 'object') {
    throw new Error('allocateToMonths: feature must be an object');
  }
  if (!Array.isArray(months)) {
    throw new Error('allocateToMonths: months must be an array');
  }

  const start = toDate(feature.start);
  const end = toDate(feature.end);

  const result = {
    cost: { internal: new Map(), external: new Map() },
    hours: { internal: new Map(), external: new Map() },
  };

  if (!start || !end) {
    // No dates: cannot allocate to months
    return result;
  }

  // Calculate total days
  const totalDays = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  );

  // Safe metric extraction
  const getMetric = (path) => {
    try {
      const parts = path.split('.');
      let val = feature;
      for (const p of parts) {
        val = val?.[p];
      }
      return typeof val === 'number' ? val : 0;
    } catch {
      return 0;
    }
  };

  const internalCost = getMetric('metrics.internal.cost');
  const internalHours = getMetric('metrics.internal.hours');
  const externalCost = getMetric('metrics.external.cost');
  const externalHours = getMetric('metrics.external.hours');

  // Allocate proportionally to each month
  for (const month of months) {
    const mKey = monthKey(month);
    const mEnd = lastOfMonth(month);

    // Calculate overlapping days
    const overlapStart = start > month ? start : month;
    const overlapEnd = end < mEnd ? end : mEnd;

    if (overlapEnd < overlapStart) continue; // No overlap

    const overlapDays =
      Math.floor(
        (overlapEnd.getTime() - overlapStart.getTime()) / (24 * 60 * 60 * 1000)
      ) + 1;
    const fraction = overlapDays / totalDays;

    result.cost.internal.set(mKey, internalCost * fraction);
    result.cost.external.set(mKey, externalCost * fraction);
    result.hours.internal.set(mKey, internalHours * fraction);
    result.hours.external.set(mKey, externalHours * fraction);
  }

  return result;
}

/**
 * Flatten a feature hierarchy into a depth-annotated list using DFS pre-order
 * so that each parent immediately precedes its children in the rendered table.
 *
 * @param {Array<string>} ids - Feature IDs at the current level
 * @param {Map<string, Array<string>>} childrenMap - From buildTaskTree
 * @param {Map<string, Object>} featureMap - id -> feature object
 * @param {number} depth - Current nesting level
 * @param {Array<{feature: Object, depth: number}>} result - Accumulator
 * @returns {Array<{feature: Object, depth: number}>}
 */
export function flattenTree(ids, childrenMap, featureMap, depth, result) {
  for (const id of ids) {
    const feature = featureMap.get(String(id));
    if (!feature) continue;
    result.push({ feature, depth });
    const children = childrenMap.get(String(id)) || [];
    flattenTree(children, childrenMap, featureMap, depth + 1, result);
  }
  return result;
}

function createAllocationMaps() {
  return {
    cost: { internal: new Map(), external: new Map() },
    hours: { internal: new Map(), external: new Map() },
  };
}

function addAllocationMaps(target, source) {
  for (const kind of ['cost', 'hours']) {
    for (const direction of ['internal', 'external']) {
      const months = target[kind][direction];
      for (const [month, value] of source[kind][direction]) {
        const previous = months.has(month) ? months.get(month) : 0;
        months.set(month, previous + value);
      }
    }
  }
}

/**
 * Sum server-resolved metrics over each retained subtree, restricted to monthKeys.
 * Allocation precedence belongs to the server, not this presentation rollup.
 *
 * @param {Array<Object>} features
 * @param {Map<string, Array<string>>} childrenMap - from buildTaskTree
 * @param {Array<string>} monthKeys - display-window month keys
 * @returns {Map<string, Map<string, {cost:{internal:Map,external:Map},hours:{internal:Map,external:Map}}>>}
 */
export function buildByTeam(features, childrenMap, monthKeys) {
  const byTeam = new Map();
  const parents = new Map(features.map((feature) => [String(feature.id), new Set()]));
  const remaining = new Map();
  for (const feature of features) {
    const id = String(feature.id);
    const children = childrenMap.has(id) ? new Set(childrenMap.get(id).map(String)) : new Set();
    remaining.set(id, children.size);
    for (const childId of children) parents.get(childId).add(id);
    const teamResult = new Map();
    for (const [team, data] of Object.entries(feature.metrics.teams)) {
      const allocation = createAllocationMaps();
      for (const kind of ['cost', 'hours']) {
        for (const direction of ['internal', 'external']) {
          for (const month of monthKeys) {
            const value = data[kind][direction][month];
            if (value !== undefined) allocation[kind][direction].set(month, Number(value));
          }
        }
      }
      teamResult.set(team, allocation);
    }
    byTeam.set(id, teamResult);
  }
  const pending = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    for (const parentId of parents.get(id)) {
      const parentTeams = byTeam.get(parentId);
      for (const [team, allocation] of byTeam.get(id)) {
        if (!parentTeams.has(team)) parentTeams.set(team, createAllocationMaps());
        addAllocationMaps(parentTeams.get(team), allocation);
      }
      const count = remaining.get(parentId) - 1;
      remaining.set(parentId, count);
      if (count === 0) pending.push(parentId);
    }
  }
  if (pending.length !== features.length) throw new Error('Cost hierarchy contains a cycle');
  return byTeam;
}

/**
 * Aggregate all team allocations from buildByTeam into a single combined
 * alloc per feature. Useful for feature lists that show total cost/hours
 * across all teams.
 *
 * @param {Array<Object>} features
 * @param {Map<string, Array<string>>} childrenMap - from buildTaskTree
 * @param {Array<string>} monthKeys - display-window month keys
 * @returns {Map<string, {cost:{internal:Map,external:Map},hours:{internal:Map,external:Map}}>}
 */
export function computeEffectiveDataMaps(features, childrenMap, monthKeys) {
  const byTeam = buildByTeam(features, childrenMap, monthKeys);

  const result = new Map();
  for (const [fid, teamMap] of byTeam.entries()) {
    const dataMap = createAllocationMaps();
    for (const alloc of teamMap.values()) addAllocationMaps(dataMap, alloc);
    result.set(fid, dataMap);
  }
  return result;
}

function summarizeTeamMetrics(team, monthKeys) {
  const totals = { cost: 0, hours: 0 };
  for (const kind of ['cost', 'hours']) {
    for (const direction of ['internal', 'external']) {
      for (const month of monthKeys) {
        const value = team[kind][direction][month];
        if (value !== undefined) totals[kind] += value;
      }
    }
  }
  return totals;
}

function summarizeTeamMaps(teams) {
  const totals = { cost: 0, hours: 0 };
  for (const allocation of teams.values()) {
    for (const kind of ['cost', 'hours']) {
      for (const direction of ['internal', 'external']) {
        for (const value of allocation[kind][direction].values()) totals[kind] += value;
      }
    }
  }
  return totals;
}

export function buildCostTaskRows(features, childrenMap, monthKeys, dateRange) {
  const byTeam = buildByTeam(features, childrenMap, monthKeys);
  const rowsById = new Map();
  const childIds = new Set([...childrenMap.values()].flat().map(String));
  for (const feature of features) {
    const id = String(feature.id);
    const total = summarizeTeamMaps(byTeam.get(id));
    const own = { cost: 0, hours: 0 };
    const comparisons = [];
    const children = childrenMap.has(id) ? childrenMap.get(id) : [];
    for (const [team, metrics] of Object.entries(feature.estimateTeams)) {
      const estimate = summarizeTeamMetrics(metrics, monthKeys);
      own.cost += estimate.cost;
      own.hours += estimate.hours;
      if (!children.some((childId) => byTeam.get(String(childId)).has(team))) continue;
      const aggregate = summarizeTeamMaps(new Map([[team, byTeam.get(id).get(team)]]));
      const charged = feature.metrics.teams[team];
      const retained = charged === undefined ? { cost: 0, hours: 0 }
        : summarizeTeamMetrics(charged, monthKeys);
      const breakdown = { cost: aggregate.cost - retained.cost, hours: aggregate.hours - retained.hours };
      const difference = breakdown.cost - estimate.cost;
      const hoursDifference = breakdown.hours - estimate.hours;
      const percent = estimate.cost !== 0 ? difference / estimate.cost * 100
        : estimate.hours !== 0 ? hoursDifference / estimate.hours * 100 : null;
      comparisons.push({ team, estimate, breakdown, difference, hoursDifference, percent });
    }
    const hasOwnEstimate = Object.keys(feature.estimateTeams).length > 0;
    const hasValidSpan = hasValidAllocationSpan(feature);
    const hasOwnAllocation = hasValidSpan
      && feature.capacity.some((allocation) => Number(allocation.capacity) !== 0);
    const overlaps = !hasValidSpan
      || (feature.start <= dateRange.end && feature.end >= dateRange.start);
    const show = feature.displayMode !== 'excluded' && overlaps
      && (feature.displayMode === 'normal' || hasOwnAllocation);
    rowsById.set(id, { feature, totalCost: total.cost, totalHours: total.hours,
      ownCost: own.cost, ownHours: own.hours, hasOwnEstimate, hasOwnAllocation, comparisons, show });
  }
  const roots = features.filter((feature) => !childIds.has(String(feature.id)));
  const pending = roots.reverse().map((feature) => ({ id: String(feature.id), depth: 0 }));
  const rows = [];
  const visited = new Set();
  while (pending.length > 0) {
    const { id, depth } = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const row = rowsById.get(id);
    if (row.show) rows.push({ ...row, depth });
    const children = childrenMap.has(id) ? childrenMap.get(id) : [];
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push({ id: String(children[index]), depth: row.show ? depth + 1 : depth });
    }
  }
  return rows;
}
