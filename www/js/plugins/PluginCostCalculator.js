/**
 * PluginCostCalculator
 * Pure utility functions for cost analysis calculations in PluginCost.
 *
 * Provides:
 * - Dataset expansion via parent/child relations
 * - Task tree building (orphans vs parents-with-children)
 * - Budget deviation calculations (parent own vs children sum)
 * - Month allocation helpers (reused from PluginCostV1Calculator)
 *
 * All functions are pure, side-effect free, and throw on invalid data
 * for explicit error handling (no silent failures).
 */

// Import and re-export month helpers from PluginCostV1Calculator for consistency
import {
  toDate,
  firstOfMonth,
  lastOfMonth,
  addMonths,
  monthKey,
  monthLabel,
  buildMonths,
} from './PluginCostV1Calculator.js';

// Re-export for external use
export {
  toDate,
  firstOfMonth,
  lastOfMonth,
  addMonths,
  monthKey,
  monthLabel,
  buildMonths,
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
