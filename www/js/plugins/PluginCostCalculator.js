/**
 * PluginCostCalculator
 * Pure utility functions for cost analysis calculations in PluginCost.
 *
 * Provides:
 * - Dataset expansion via parent/child relations
 * - Task tree building (orphans vs parents-with-children)
 * - Budget deviation calculations (parent own vs children sum)
 * Month and project allocation helpers consumed by the cost UI.
 *
 * All functions are pure, side-effect free, and throw on invalid data
 * for explicit error handling (no silent failures).
 */
import { isEnabled } from '../config.js';

/**
 * Parse an ISO date-only string into a Date in UTC at midnight.
 * @param {string|Date} d
 * @returns {Date|null}
 */
export function toDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  return new Date(`${d}T00:00:00Z`);
}

/**
 * Return the first instant (UTC) of the month for the given date.
 * @param {Date} dt
 * @returns {Date}
 */
export function firstOfMonth(dt) {
  if (!dt) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
}

/**
 * Return the last instant (UTC) of the month for the given date.
 * @param {Date} dt
 * @returns {Date}
 */
export function lastOfMonth(dt) {
  if (!dt) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
}

/**
 * Add N months to a UTC-based date and return a new Date at the first of
 * that resulting month (UTC).
 * @param {Date} dt
 * @param {number} n
 * @returns {Date}
 */
export function addMonths(dt, n) {
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + n, 1));
}

/**
 * Create a stable month key in YYYY-MM format using UTC month/year.
 * @param {Date} dt
 * @returns {string}
 */
export function monthKey(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Human friendly month label used in the table header.
 * @param {Date} dt
 * @returns {string}
 */
export function monthLabel(dt) {
  return dt.toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * Build an ordered array of Date objects representing each month between the
 * provided dataset start and end (inclusive).
 * @param {{dataset_start: Date|string, dataset_end: Date|string}} cfg
 * @returns {Date[]}
 */
export function buildMonths({ dataset_start, dataset_end }) {
  const start = firstOfMonth(toDate(dataset_start));
  const end = firstOfMonth(toDate(dataset_end));
  if (!start || !end) return [];
  const out = [];
  for (let cur = start; cur <= end; cur = addMonths(cur, 1)) out.push(new Date(cur));
  return out;
}

/**
 * Create an object mapping each key to zero.
 * @param {string[]} keys
 * @returns {Object<string, number>}
 */
function zerosFor(keys) {
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

/**
 * Numeric sum helper.
 * @param {number[]} arr
 * @returns {number}
 */
function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

/**
 * Calculate inclusive number of overlapping days between [start, end] and the
 * month starting at mStart. All dates are treated as UTC-midnights.
 * @param {Date} start
 * @param {Date} end
 * @param {Date} mStart - first of month
 * @returns {number} inclusive number of days overlapping the month
 */
function overlapDays(start, end, mStart) {
  if (!start || !end || !mStart) return 0;
  const mEnd = lastOfMonth(mStart);
  if (!mEnd) return 0;
  const s = start > mStart ? start : mStart;
  const e = end < mEnd ? end : mEnd;
  if (e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Normalize a raw feature metric entry into per-month allocations.
 *
 * @param {Object} raw
 * @param {string[]} monthKeys
 * @param {Date[]} months
 * @returns {Object}
 */
function buildFeature(raw, monthKeys, months) {
  const featureStart = raw.start ?? null;
  const featureEnd = raw.end ?? null;
  const start = toDate(featureStart);
  const end = toDate(featureEnd);
  const internalTotal = raw.metrics.internal.cost;
  const externalTotal = raw.metrics.external.cost;
  const internalHoursTotal = raw.metrics.internal.hours;
  const externalHoursTotal = raw.metrics.external.hours;

  if (!start || !end) {
    const valuesInternal = zerosFor(monthKeys);
    const valuesExternal = zerosFor(monthKeys);
    const hoursInternal = zerosFor(monthKeys);
    const hoursExternal = zerosFor(monthKeys);

    const numMonths = monthKeys.length || 1;
    const perMonInt = internalTotal / numMonths;
    const perMonExt = externalTotal / numMonths;
    const perMonIntH = internalHoursTotal / numMonths;
    const perMonExtH = externalHoursTotal / numMonths;

    for (const mk of monthKeys) {
      valuesInternal[mk] = perMonInt;
      valuesExternal[mk] = perMonExt;
      hoursInternal[mk] = perMonIntH;
      hoursExternal[mk] = perMonExtH;
    }

    const teams = {};
    if (Array.isArray(raw.capacity) && raw.capacity.length) {
      const totalCap = raw.capacity.reduce((a, b) => a + (b.capacity || 0), 0) || 0;
      for (const entry of raw.capacity) {
        const tid = String(entry.team || entry.id || entry.name || 'unassigned');
        const cap = (entry.capacity || 0) / (totalCap || 1);
        const tValuesInternal = zerosFor(monthKeys);
        const tValuesExternal = zerosFor(monthKeys);
        const tHoursInternal = zerosFor(monthKeys);
        const tHoursExternal = zerosFor(monthKeys);
        for (const mk of monthKeys) {
          tValuesInternal[mk] = (valuesInternal[mk] || 0) * cap;
          tValuesExternal[mk] = (valuesExternal[mk] || 0) * cap;
          tHoursInternal[mk] = (hoursInternal[mk] || 0) * cap;
          tHoursExternal[mk] = (hoursExternal[mk] || 0) * cap;
        }
        teams[tid] = {
          valuesInternal: tValuesInternal,
          valuesExternal: tValuesExternal,
          hoursInternal: tHoursInternal,
          hoursExternal: tHoursExternal,
          internalTotal: sum(Object.values(tValuesInternal)),
          externalTotal: sum(Object.values(tValuesExternal)),
          internalHoursTotal: sum(Object.values(tHoursInternal)),
          externalHoursTotal: sum(Object.values(tHoursExternal)),
          total: +(sum(Object.values(tValuesInternal)) + sum(Object.values(tValuesExternal))).toFixed(2),
          totalHours: +(sum(Object.values(tHoursInternal)) + sum(Object.values(tHoursExternal))).toFixed(2),
        };
      }
    }

    return {
      id: String(raw.id),
      title: raw.title,
      start: featureStart,
      end: featureEnd,
      monthsCovered: monthKeys,
      valuesInternal,
      valuesExternal,
      hoursInternal,
      hoursExternal,
      internalTotal,
      externalTotal,
      internalHoursTotal,
      externalHoursTotal,
      has_project_parent: raw.has_project_parent,
      teams,
    };
  }

  const sMonth = firstOfMonth(start);
  const eMonth = firstOfMonth(end);
  const monthsCovered = [];
  for (let cur = new Date(sMonth); cur <= eMonth; cur = addMonths(cur, 1)) monthsCovered.push(monthKey(cur));

  const monthStartMap = Object.fromEntries(months.map((m) => [monthKey(m), firstOfMonth(m)]));
  const daysByMonth = {};
  let totalDays = 0;
  for (const mk of monthsCovered) {
    const d = overlapDays(start, end, monthStartMap[mk]);
    daysByMonth[mk] = d;
    totalDays += d;
  }

  const valuesInternal = zerosFor(monthKeys);
  const valuesExternal = zerosFor(monthKeys);
  const hoursInternal = zerosFor(monthKeys);
  const hoursExternal = zerosFor(monthKeys);

  if (totalDays > 0) {
    const perDayInt = internalTotal / totalDays;
    const perDayExt = externalTotal / totalDays;
    const perDayIntH = internalHoursTotal / totalDays;
    const perDayExtH = externalHoursTotal / totalDays;
    for (const mk of monthsCovered) {
      valuesInternal[mk] = perDayInt * (daysByMonth[mk] || 0);
      valuesExternal[mk] = perDayExt * (daysByMonth[mk] || 0);
      hoursInternal[mk] = perDayIntH * (daysByMonth[mk] || 0);
      hoursExternal[mk] = perDayExtH * (daysByMonth[mk] || 0);
    }
  } else if (monthsCovered.length) {
    const perMonInt = internalTotal / monthsCovered.length;
    const perMonExt = externalTotal / monthsCovered.length;
    const perMonIntH = internalHoursTotal / monthsCovered.length;
    const perMonExtH = externalHoursTotal / monthsCovered.length;
    for (const mk of monthsCovered) {
      valuesInternal[mk] = perMonInt;
      valuesExternal[mk] = perMonExt;
      hoursInternal[mk] = perMonIntH;
      hoursExternal[mk] = perMonExtH;
    }
  }

  return {
    id: String(raw.id),
    title: raw.title,
    start: featureStart,
    end: featureEnd,
    monthsCovered,
    valuesInternal,
    valuesExternal,
    hoursInternal,
    hoursExternal,
    internalTotal,
    externalTotal,
    internalHoursTotal,
    externalHoursTotal,
    has_project_parent: raw.has_project_parent,
    teams:
      Array.isArray(raw.capacity) && raw.capacity.length ? (() => {
        const t = {};
        const totalCap = raw.capacity.reduce((a, b) => a + (b.capacity || 0), 0) || 0;
        for (const entry of raw.capacity) {
          const tid = String(entry.team || entry.id || entry.name || 'unassigned');
          const cap = (entry.capacity || 0) / (totalCap || 1);
          const tValuesInternal = zerosFor(monthKeys);
          const tValuesExternal = zerosFor(monthKeys);
          const tHoursInternal = zerosFor(monthKeys);
          const tHoursExternal = zerosFor(monthKeys);
          for (const mk of monthKeys) {
            tValuesInternal[mk] = (valuesInternal[mk] || 0) * cap;
            tValuesExternal[mk] = (valuesExternal[mk] || 0) * cap;
            tHoursInternal[mk] = (hoursInternal[mk] || 0) * cap;
            tHoursExternal[mk] = (hoursExternal[mk] || 0) * cap;
          }
          t[tid] = {
            valuesInternal: tValuesInternal,
            valuesExternal: tValuesExternal,
            hoursInternal: tHoursInternal,
            hoursExternal: tHoursExternal,
            internalTotal: sum(Object.values(tValuesInternal)),
            externalTotal: sum(Object.values(tValuesExternal)),
            internalHoursTotal: sum(Object.values(tHoursInternal)),
            externalHoursTotal: sum(Object.values(tHoursExternal)),
            total: +(sum(Object.values(tValuesInternal)) + sum(Object.values(tValuesExternal))).toFixed(2),
            totalHours: +(sum(Object.values(tHoursInternal)) + sum(Object.values(tHoursExternal))).toFixed(2),
          };
        }
        return t;
      })() : {},
  };
}

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
 * Calculate budget deviation between parent's own cost/hours and sum of children.
 *
 * Budget deviation helps identify planning discrepancies where a parent task's
 * own allocated capacity differs from the sum of its children's capacity.
 *
 * @param {Object} parent - Parent feature with metrics
 * @param {Array<Object>} children - Child features with metrics
 * @returns {{parentOwn: Object, childrenSum: Object, deviation: Object}}
 *   Deviation object contains percentages for internal/external cost/hours
 * @throws {Error} If parent or children have invalid structure
 */
export function calculateBudgetDeviation(parent, children) {
  if (!parent || typeof parent !== 'object') {
    throw new Error('calculateBudgetDeviation: parent must be an object');
  }
  if (!Array.isArray(children)) {
    throw new Error('calculateBudgetDeviation: children must be an array');
  }

  // Safe metric extraction with defaults
  const getMetric = (feature, path) => {
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

  const parentOwn = {
    internalCost: getMetric(parent, 'metrics.internal.cost'),
    internalHours: getMetric(parent, 'metrics.internal.hours'),
    externalCost: getMetric(parent, 'metrics.external.cost'),
    externalHours: getMetric(parent, 'metrics.external.hours'),
    totalCost: 0,
    totalHours: 0,
  };
  parentOwn.totalCost = parentOwn.internalCost + parentOwn.externalCost;
  parentOwn.totalHours = parentOwn.internalHours + parentOwn.externalHours;

  const childrenSum = {
    internalCost: 0,
    internalHours: 0,
    externalCost: 0,
    externalHours: 0,
    totalCost: 0,
    totalHours: 0,
  };

  for (const child of children) {
    childrenSum.internalCost += getMetric(child, 'metrics.internal.cost');
    childrenSum.internalHours += getMetric(child, 'metrics.internal.hours');
    childrenSum.externalCost += getMetric(child, 'metrics.external.cost');
    childrenSum.externalHours += getMetric(child, 'metrics.external.hours');
  }
  childrenSum.totalCost = childrenSum.internalCost + childrenSum.externalCost;
  childrenSum.totalHours = childrenSum.internalHours + childrenSum.externalHours;

  // Calculate percentage deviation (parent - children) / children * 100
  const calcDeviation = (parentVal, childVal) => {
    if (childVal === 0) {
      return parentVal === 0 ? 0 : 100; // 100% if parent has value but no children
    }
    return ((parentVal - childVal) / childVal) * 100;
  };

  const deviation = {
    internalCost: calcDeviation(parentOwn.internalCost, childrenSum.internalCost),
    internalHours: calcDeviation(parentOwn.internalHours, childrenSum.internalHours),
    externalCost: calcDeviation(parentOwn.externalCost, childrenSum.externalCost),
    externalHours: calcDeviation(parentOwn.externalHours, childrenSum.externalHours),
    totalCost: calcDeviation(parentOwn.totalCost, childrenSum.totalCost),
    totalHours: calcDeviation(parentOwn.totalHours, childrenSum.totalHours),
  };

  return { parentOwn, childrenSum, deviation };
}

/**
 * Check if deviation exceeds threshold (default 10%).
 *
 * @param {Object} deviation - Deviation object from calculateBudgetDeviation
 * @param {number} threshold - Percentage threshold (default 10)
 * @returns {boolean} True if any deviation metric exceeds threshold
 */
export function hasSignificantDeviation(deviation, threshold = 10) {
  if (!deviation || typeof deviation !== 'object') return false;

  const metrics = [
    'totalCost',
    'totalHours',
    'internalCost',
    'internalHours',
    'externalCost',
    'externalHours',
  ];
  return metrics.some((m) => Math.abs(deviation[m] || 0) > threshold);
}

/**
 * Allocate feature cost/hours to months based on date overlap.
 *
 * Uses same logic as PluginCostCalculator: distributes values proportionally
 * across months based on overlapping days.
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

/**
 * Bottom-up per-team rollup (children are authoritative for their covered teams).
 *
 * Returns Map<featureId, Map<teamName, alloc>> where each alloc is restricted to
 * monthKeys. Per-team rules (post-order):
 *  - Leaf: own server per-team data.
 *  - Parent: for each team it owns, if any direct child in the dataset covers
 *    that team → sum children's effective allocations; otherwise keep own.
 *    Teams only present in children (not owned by parent) are passed through.
 *
 * @param {Array<Object>} features
 * @param {Map<string, Array<string>>} childrenMap - from buildTaskTree
 * @param {Array<string>} monthKeys - display-window month keys
 * @returns {Map<string, Map<string, {cost:{internal:Map,external:Map},hours:{internal:Map,external:Map}}>>}
 */
export function buildByTeam(features, childrenMap, monthKeys) {
  const featureMap = new Map(features.map((f) => [String(f.id), f]));

  const mkAlloc = () => ({
    cost: { internal: new Map(), external: new Map() },
    hours: { internal: new Map(), external: new Map() },
  });

  const addAllocs = (dst, src) => {
    for (const kind of ['cost', 'hours'])
      for (const dir of ['internal', 'external'])
        for (const [mk, v] of src[kind][dir].entries())
          dst[kind][dir].set(mk, (dst[kind][dir].get(mk) || 0) + v);
  };

  const fromServerTeam = (teamData) => {
    const alloc = mkAlloc();
    for (const kind of ['cost', 'hours'])
      for (const dir of ['internal', 'external']) {
        const obj = (teamData[kind] && teamData[kind][dir]) || {};
        for (const mk of monthKeys)
          if (obj[mk] != null) alloc[kind][dir].set(mk, Number(obj[mk]));
      }
    return alloc;
  };

  // Handles flat metrics shapes: { internal: { cost: {...} } } or { cost: { internal: {...} } }
  const fromFlatMetrics = (metrics) => {
    const alloc = mkAlloc();
    for (const kind of ['cost', 'hours']) {
      const intObj =
        (metrics.internal && metrics.internal[kind]) ||
        (metrics[kind] && metrics[kind].internal) ||
        {};
      const extObj =
        (metrics.external && metrics.external[kind]) ||
        (metrics[kind] && metrics[kind].external) ||
        {};
      for (const mk of monthKeys) {
        if (intObj[mk] != null) alloc[kind].internal.set(mk, Number(intObj[mk]));
        if (extObj[mk] != null) alloc[kind].external.set(mk, Number(extObj[mk]));
      }
    }
    return alloc;
  };

  const byTeam = new Map();

  function processNode(fid) {
    if (byTeam.has(fid)) return;
    const feature = featureMap.get(fid);
    if (!feature) {
      byTeam.set(fid, new Map());
      return;
    }

    const children = (childrenMap.get(fid) || []).map(String);
    for (const cid of children) processNode(cid);

    const ownTeams = (feature.metrics && feature.metrics.teams) || {};
    const hasOwnTeams = Object.keys(ownTeams).length > 0;
    const teamResult = new Map();

    if (children.length === 0) {
      if (hasOwnTeams) {
        for (const [teamName, teamData] of Object.entries(ownTeams))
          teamResult.set(teamName, fromServerTeam(teamData));
      } else if (feature.metrics) {
        // Flat metrics fallback: no per-team breakdown available
        teamResult.set('__flat__', fromFlatMetrics(feature.metrics));
      }
    } else {
      const childCoveredTeams = new Set();
      for (const cid of children) {
        const ct = (featureMap.get(cid)?.metrics?.teams) || {};
        for (const t of Object.keys(ct)) childCoveredTeams.add(t);
      }

      if (hasOwnTeams) {
        for (const [teamName, teamData] of Object.entries(ownTeams)) {
          if (childCoveredTeams.has(teamName)) {
            // Children cover this team: sum children's effective allocations
            const merged = mkAlloc();
            for (const cid of children) {
              const a = byTeam.get(cid)?.get(teamName);
              if (a) addAllocs(merged, a);
            }
            teamResult.set(teamName, merged);
          } else {
            // No child covers this team: use own allocation
            teamResult.set(teamName, fromServerTeam(teamData));
          }
        }
      }

      // Pass through teams that children have but the parent doesn't own
      for (const cid of children) {
        const cm = byTeam.get(cid);
        if (!cm) continue;
        for (const [teamName, alloc] of cm.entries()) {
          if (teamResult.has(teamName)) continue;
          teamResult.set(teamName, mkAlloc());
          addAllocs(teamResult.get(teamName), alloc);
        }
      }
    }

    byTeam.set(fid, teamResult);
  }

  for (const f of features) processNode(String(f.id));
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

  const mkAlloc = () => ({
    cost: { internal: new Map(), external: new Map() },
    hours: { internal: new Map(), external: new Map() },
  });

  const addAllocs = (dst, src) => {
    for (const kind of ['cost', 'hours'])
      for (const dir of ['internal', 'external'])
        for (const [mk, v] of src[kind][dir].entries())
          dst[kind][dir].set(mk, (dst[kind][dir].get(mk) || 0) + v);
  };

  const result = new Map();
  for (const [fid, teamMap] of byTeam.entries()) {
    const dataMap = mkAlloc();
    for (const alloc of teamMap.values()) addAllocs(dataMap, alloc);
    result.set(fid, dataMap);
  }
  return result;
}

/**
 * Build normalized project objects from raw project payloads.
 *
 * @param {Array<Object>} projects
 * @param {Array<Date>} months
 * @param {Object} state - global app state used to resolve epic children
 * @returns {Object} { projects: Array, footerHours: Object, footerTotalHours: number }
 */
export function buildProjects(projects, months, state) {
  const monthKeys = months.map(monthKey);
  const useEpicGapFills = isEnabled('USE_PARENT_CAPACITY_GAP_FILLS');

  const projectsOut = (projects || []).map((p) => {
    const feats = (p.features || []).map((f) => buildFeature(f, monthKeys, months));
    const featById = new Map(feats.map((f) => [f.id, f]));

    const childrenMap = new Map();
    const featuresList = p.features || [];
    if (state?.childrenByParent?.get) {
      for (const f of featuresList) {
        const raw =
          state.childrenByParent.get(Number(f.id)) ||
          state.childrenByParent.get(String(f.id)) ||
          [];
        if (raw.length) childrenMap.set(String(f.id), raw.map(String));
      }
    } else {
      for (const f of featuresList) {
        if (f.parentId || f.parentId === 0) {
          const key = String(f.parentId);
          childrenMap.set(key, (childrenMap.get(key) || []).concat(String(f.id)));
        }
      }
    }

    for (const f of feats) {
      f.originalTotal = f.internalTotal + f.externalTotal;
      f.originalTotalHours = f.internalHoursTotal + f.externalHoursTotal;
    }

    for (const [epicId, childIds] of childrenMap.entries()) {
      const childList = childIds.map((id) => featById.get(String(id))).filter(Boolean);
      if (!childList.length) continue;
      const epic = featById.get(String(epicId));

      const childInt = zerosFor(monthKeys);
      const childExt = zerosFor(monthKeys);
      const childIH = zerosFor(monthKeys);
      const childEH = zerosFor(monthKeys);
      for (const c of childList) {
        for (const [k, v] of Object.entries(c.valuesInternal || {})) childInt[k] += v;
        for (const [k, v] of Object.entries(c.valuesExternal || {})) childExt[k] += v;
        for (const [k, v] of Object.entries(c.hoursInternal || {})) childIH[k] += v;
        for (const [k, v] of Object.entries(c.hoursExternal || {})) childEH[k] += v;
      }

      if (!useEpicGapFills) {
        if (epic) {
          epic.valuesInternal = childInt;
          epic.valuesExternal = childExt;
          epic.hoursInternal = childIH;
          epic.hoursExternal = childEH;
          epic.internalTotal = sum(Object.values(childInt));
          epic.externalTotal = sum(Object.values(childExt));
          epic.internalHoursTotal = sum(Object.values(childIH));
          epic.externalHoursTotal = sum(Object.values(childEH));
        }
        continue;
      }

      if (!epic) continue;

      const monthsWithChild = monthKeys.filter((k) => childInt[k] + childExt[k] > 0);
      const avgChildInt =
        monthsWithChild.length ? sum(monthsWithChild.map((k) => childInt[k])) / monthsWithChild.length : 0;
      const avgChildExt =
        monthsWithChild.length ? sum(monthsWithChild.map((k) => childExt[k])) / monthsWithChild.length : 0;

      const newInt = zerosFor(monthKeys);
      const newExt = zerosFor(monthKeys);
      const newIH = zerosFor(monthKeys);
      const newEH = zerosFor(monthKeys);
      for (const k of monthKeys) {
        if ((childInt[k] || 0) + (childExt[k] || 0) > 0) {
          newInt[k] = 0;
          newExt[k] = 0;
          newIH[k] = 0;
          newEH[k] = 0;
        } else {
          newInt[k] = epic.valuesInternal[k] || avgChildInt || 0;
          newExt[k] = epic.valuesExternal[k] || avgChildExt || 0;
          newIH[k] = epic.hoursInternal[k] || 0;
          newEH[k] = epic.hoursExternal[k] || 0;
        }
      }
      epic.valuesInternal = newInt;
      epic.valuesExternal = newExt;
      epic.hoursInternal = newIH;
      epic.hoursExternal = newEH;
      epic.internalTotal = sum(Object.values(newInt));
      epic.externalTotal = sum(Object.values(newExt));
      epic.internalHoursTotal = sum(Object.values(newIH));
      epic.externalHoursTotal = sum(Object.values(newEH));
    }

    const normalizedFeatures = feats.map((f) => {
      const lastMk =
        f.monthsCovered.length ? f.monthsCovered[f.monthsCovered.length - 1] : monthKeys[monthKeys.length - 1];
      const roundMap = (src, total) => {
        const out = {};
        for (const k of monthKeys) out[k] = +(src[k] || 0).toFixed(2);
        const diff = +(total - sum(Object.values(out))).toFixed(2);
        if (Math.abs(diff) > 0.001 && lastMk) out[lastMk] = +((out[lastMk] || 0) + diff).toFixed(2);
        return out;
      };

      const internal = roundMap(f.valuesInternal || {}, f.internalTotal || 0);
      const external = roundMap(f.valuesExternal || {}, f.externalTotal || 0);
      const hoursI = roundMap(f.hoursInternal || {}, f.internalHoursTotal || 0);
      const hoursE = roundMap(f.hoursExternal || {}, f.externalHoursTotal || 0);

      const total = +(sum(Object.values(internal)) + sum(Object.values(external))).toFixed(2);
      const totalHours = +(sum(Object.values(hoursI)) + sum(Object.values(hoursE))).toFixed(2);

      const teamsMap = {};
      if (f.teams && typeof f.teams === 'object') {
        for (const [tid, t] of Object.entries(f.teams)) {
          const tInternal = roundMap(t.valuesInternal || {}, t.internalTotal || 0);
          const tExternal = roundMap(t.valuesExternal || {}, t.externalTotal || 0);
          const tHoursI = roundMap(t.hoursInternal || {}, t.internalHoursTotal || 0);
          const tHoursE = roundMap(t.hoursExternal || {}, t.externalHoursTotal || 0);
          teamsMap[tid] = {
            values: { internal: tInternal, external: tExternal },
            hours: { internal: tHoursI, external: tHoursE },
            internalTotal: +sum(Object.values(tInternal)).toFixed(2),
            externalTotal: +sum(Object.values(tExternal)).toFixed(2),
            total: +(sum(Object.values(tInternal)) + sum(Object.values(tExternal))).toFixed(2),
            internalHoursTotal: +sum(Object.values(tHoursI)).toFixed(2),
            externalHoursTotal: +sum(Object.values(tHoursE)).toFixed(2),
            totalHours: +(sum(Object.values(tHoursI)) + sum(Object.values(tHoursE))).toFixed(2),
          };
        }
      }

      return {
        id: f.id,
        name: f.title,
        state: '',
        values: { internal, external },
        hours: { internal: hoursI, external: hoursE },
        internalTotal: +sum(Object.values(internal)).toFixed(2),
        externalTotal: +sum(Object.values(external)).toFixed(2),
        total,
        internalHoursTotal: +sum(Object.values(hoursI)).toFixed(2),
        externalHoursTotal: +sum(Object.values(hoursE)).toFixed(2),
        totalHours,
        start: f.start,
        end: f.end,
        monthsCovered: f.monthsCovered,
        originalTotal: f.originalTotal,
        originalTotalHours: f.originalTotalHours,
        has_project_parent: f.has_project_parent,
        teams: teamsMap,
      };
    });

    const allChildIds = new Set([].concat(...Array.from(childrenMap.values()).map((a) => a.map(String))));
    const totals = {
      internal: zerosFor(monthKeys),
      external: zerosFor(monthKeys),
      hours: { internal: zerosFor(monthKeys), external: zerosFor(monthKeys) },
    };
    let projectTotal = 0;
    let projectTotalHours = 0;

    const totalsNoProject = {
      internal: zerosFor(monthKeys),
      external: zerosFor(monthKeys),
      hours: { internal: zerosFor(monthKeys), external: zerosFor(monthKeys) },
    };
    let noProjectTotal = 0;
    let noProjectTotalHours = 0;

    for (const f of normalizedFeatures) {
      if (allChildIds.has(String(f.id))) continue;

      for (const k of monthKeys) {
        totals.internal[k] += f.values.internal[k] || 0;
        totals.external[k] += f.values.external[k] || 0;
        totals.hours.internal[k] += f.hours.internal[k] || 0;
        totals.hours.external[k] += f.hours.external[k] || 0;
      }
      projectTotal += f.total;
      projectTotalHours += f.totalHours;

      if (!f.has_project_parent) {
        for (const k of monthKeys) {
          totalsNoProject.internal[k] += f.values.internal[k] || 0;
          totalsNoProject.external[k] += f.values.external[k] || 0;
          totalsNoProject.hours.internal[k] += f.hours.internal[k] || 0;
          totalsNoProject.hours.external[k] += f.hours.external[k] || 0;
        }
        noProjectTotal += f.total;
        noProjectTotalHours += f.totalHours;
      }
    }

    const teamTotals = {};
    for (const f of normalizedFeatures) {
      if (allChildIds.has(String(f.id))) continue;
      const teamsForFeature =
        f.teams && Object.keys(f.teams).length ? f.teams : {
          unassigned: {
            values: { internal: f.values.internal, external: f.values.external },
            hours: { internal: f.hours.internal, external: f.hours.external },
            internalTotal: f.internalTotal,
            externalTotal: f.externalTotal,
            total: f.total,
            internalHoursTotal: f.internalHoursTotal,
            externalHoursTotal: f.externalHoursTotal,
            totalHours: f.totalHours,
          },
        };
      for (const [tid, t] of Object.entries(teamsForFeature)) {
        if (!teamTotals[tid]) {
          teamTotals[tid] = {
            internal: zerosFor(monthKeys),
            external: zerosFor(monthKeys),
            hours: { internal: zerosFor(monthKeys), external: zerosFor(monthKeys) },
            total: 0,
            totalHours: 0,
          };
        }
        for (const k of monthKeys) {
          teamTotals[tid].internal[k] += (t.values && t.values.internal && (t.values.internal[k] || 0)) || 0;
          teamTotals[tid].external[k] += (t.values && t.values.external && (t.values.external[k] || 0)) || 0;
          teamTotals[tid].hours.internal[k] += (t.hours && t.hours.internal && (t.hours.internal[k] || 0)) || 0;
          teamTotals[tid].hours.external[k] += (t.hours && t.hours.external && (t.hours.external[k] || 0)) || 0;
        }
        teamTotals[tid].total += t.total || 0;
        teamTotals[tid].totalHours += t.totalHours || 0;
      }
    }

    return {
      id: p.id,
      name: p.name,
      type: p.type || 'project',
      features: normalizedFeatures,
      totals,
      total: +projectTotal.toFixed(2),
      totalHours: +projectTotalHours.toFixed(2),
      totalsNoProject,
      noProjectTotal: +noProjectTotal.toFixed(2),
      noProjectTotalHours: +noProjectTotalHours.toFixed(2),
      teamTotals,
    };
  });

  const footerHours = {
    internal: zerosFor(months.map(monthKey)),
    external: zerosFor(months.map(monthKey)),
  };
  let footerTotalHours = 0;
  for (const p of projectsOut) {
    for (const k of Object.keys(p.totals.hours.internal)) footerHours.internal[k] += p.totals.hours.internal[k] || 0;
    for (const k of Object.keys(p.totals.hours.external)) footerHours.external[k] += p.totals.hours.external[k] || 0;
    footerTotalHours += +p.totalHours;
  }

  projectsOut.sort((a, b) => {
    const aId = String(a.id || '');
    const bId = String(b.id || '');
    const aType = String(a.type || 'project');
    const bType = String(b.type || 'project');

    const typeOrder = (t) => (t === 'project' ? 0 : t === 'team' ? 1 : 2);
    const aOrder = typeOrder(aType);
    const bOrder = typeOrder(bType);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return aId.localeCompare(bId);
  });

  return { projects: projectsOut, footerHours, footerTotalHours };
}
