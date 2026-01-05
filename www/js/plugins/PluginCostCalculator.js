/**
 * PluginCostCalculator
 * Single-responsibility: convert raw feature-level cost/hours metrics into
 * per-month allocations and project summaries consumed by the cost UI.
 *
 * Purpose: Provide pure, side-effect free helper utilities used by the
 * `plugin-cost` component to build consistent month lists, allocate values
 * across calendar months, and aggregate project/footer totals.
 *
 * Dependencies: none (only uses standard Date math). Exported functions are
 * intentionally small and testable.
 */

/**
 * @typedef {Object} FeatureMetricRaw
 * @property {string|number} id
 * @property {string} title
 * @property {string} start - ISO date string (e.g. "2023-01-01")
 * @property {string} end - ISO date string
 * @property {Object} metrics
 * @property {Object} metrics.internal
 * @property {number} metrics.internal.cost
 * @property {number} metrics.internal.hours
 * @property {Object} metrics.external
 * @property {number} metrics.external.cost
 * @property {number} metrics.external.hours
 */

/**
 * @typedef {Object} ProjectRaw
 * @property {string|number} id
 * @property {string} name
 * @property {Array<FeatureMetricRaw>} features
 */

/**
 * @typedef {Object} MonthsRange
 * @property {Date} dataset_start
 * @property {Date} dataset_end
 */

import { isEnabled } from '../config.js';

/**
 * Parse an ISO date-only string into a Date in UTC at midnight.
 * @param {string|Date} d
 * @returns {Date}
 */
const toDate = d => new Date(`${d}T00:00:00Z`);

/**
 * Return the first instant (UTC) of the month for the given date.
 * @param {Date} dt
 * @returns {Date}
 */
const firstOfMonth = dt => new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));

/**
 * Return the last instant (UTC) of the month for the given date.
 * @param {Date} dt
 * @returns {Date}
 */
const lastOfMonth = dt => new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));

/**
 * Add N months to a UTC-based date and return a new Date at the first of
 * that resulting month (UTC).
 * @param {Date} dt
 * @param {number} n
 * @returns {Date}
 */
const addMonths = (dt, n) => new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + n, 1));

/**
 * Create a stable month key in YYYY-MM format using UTC month/year.
 * @param {Date} dt
 * @returns {string}
 */
const monthKey = dt => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Human friendly month label used in the table header.
 * @param {Date} dt
 * @returns {string}
 */
const monthLabel = dt => dt.toLocaleString(undefined, { month: 'short', year: 'numeric' });

/**
 * Build an ordered array of Date objects representing each month between the
 * provided dataset start and end (inclusive). Uses UTC-first-of-month
 * semantics to avoid timezone drift.
 * @param {MonthsRange} cfg
 * @returns {Date[]}
 */
const buildMonths = ({ dataset_start, dataset_end }) => {
  const start = firstOfMonth(toDate(dataset_start));
  const end = firstOfMonth(toDate(dataset_end));
  const out = [];
  for (let cur = start; cur <= end; cur = addMonths(cur, 1)) out.push(new Date(cur));
  return out;
};

/**
 * Helper: create an object mapping each key to zero.
 * @param {string[]} keys
 * @returns {Object<string, number>}
 */
const zerosFor = keys => Object.fromEntries(keys.map(k => [k, 0]));

/**
 * Numeric sum helper.
 * @param {number[]} arr
 * @returns {number}
 */
const sum = arr => arr.reduce((a, b) => a + b, 0);

/**
 * Calculate inclusive number of overlapping days between [start, end] and the
 * month starting at mStart. All dates are treated as UTC-midnights.
 * @param {Date} start
 * @param {Date} end
 * @param {Date} mStart - first of month
 * @returns {number} inclusive number of days overlapping the month
 */
const overlapDays = (start, end, mStart) => {
  const mEnd = lastOfMonth(mStart);
  const s = start > mStart ? start : mStart;
  const e = end < mEnd ? end : mEnd;
  if (e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1;
};

/**
 * Normalize a raw feature metric entry into per-month allocations.
 * Allocation strategy:
 * - If overlapping days can be computed, allocate per-day and multiply by
 *   number of overlapping days for each month (more accurate across partial
 *   months).
 * - If no overlapping day resolution is possible, fall back to equal per-month
 *   distribution across months fully covered by the feature.
 *
 * @param {FeatureMetricRaw} raw
 * @param {string[]} monthKeys - keys for all months in the table (YYYY-MM)
 * @param {Date[]} months - Date objects for months used to build monthStartMap
 * @returns {Object} built feature with per-month allocations
 */
const buildFeature = (raw, monthKeys, months) => {
  const start = toDate(raw.start);
  const end = toDate(raw.end);
  const internalTotal = raw.metrics.internal.cost;
  const externalTotal = raw.metrics.external.cost;
  const internalHoursTotal = raw.metrics.internal.hours;
  const externalHoursTotal = raw.metrics.external.hours;

  const sMonth = firstOfMonth(start);
  const eMonth = firstOfMonth(end);
  const monthsCovered = [];
  for (let cur = new Date(sMonth); cur <= eMonth; cur = addMonths(cur, 1)) monthsCovered.push(monthKey(cur));

  const monthStartMap = Object.fromEntries(months.map(m => [monthKey(m), firstOfMonth(m)]));
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
    start: raw.start_date,
    end: raw.end_date,
    monthsCovered,
    valuesInternal,
    valuesExternal,
    hoursInternal,
    hoursExternal,
    internalTotal,
    externalTotal,
    internalHoursTotal,
    externalHoursTotal
  };
};

/**
 * Build normalized project objects from raw project payloads. This function
 * applies epic gap-fill logic (when enabled via feature flag) and performs
 * final rounding/adjustments so that month-sums match feature totals.
 *
 * @param {ProjectRaw[]} projects
 * @param {Date[]} months
 * @param {Object} state - global app state used to resolve epic children
 * @returns {Object} { projects: Array, footerHours: Object, footerTotalHours: number }
 */
const buildProjects = (projects, months, state) => {
  const monthKeys = months.map(monthKey);
  const useEpicGapFills = isEnabled('USE_EPIC_CAPACITY_GAP_FILLS');

  const projectsOut = (projects || []).map(p => {
    const feats = (p.features || []).map(f => buildFeature(f, monthKeys, months));
    const featById = new Map(feats.map(f => [f.id, f]));

      const childrenMap = new Map();
      const featuresList = p.features || [];
      if (state?.childrenByEpic?.get) {
        for (const f of featuresList) {
          const raw = state.childrenByEpic.get(Number(f.id)) || state.childrenByEpic.get(String(f.id)) || [];
          if (raw.length) childrenMap.set(String(f.id), raw.map(String));
        }
      } else {
        for (const f of featuresList) {
          if (f.parentEpic || f.parentEpic === 0) {
            const key = String(f.parentEpic);
            childrenMap.set(key, (childrenMap.get(key) || []).concat(String(f.id)));
          }
        }
      }

    // IMPORTANT: Preserve original totals for ALL features BEFORE any epic aggregation
    // This ensures deviation detection works correctly on initial load
    for (const f of feats) {
      f.originalTotal = f.internalTotal + f.externalTotal;
      f.originalTotalHours = f.internalHoursTotal + f.externalHoursTotal;
    }

    for (const [epicId, childIds] of childrenMap.entries()) {
      const childList = childIds.map(id => featById.get(String(id))).filter(Boolean);
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
          // Replace Epic values with children sum (originalTotal already set above)
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
      // originalTotal already set above for all features
      
      const monthsWithChild = monthKeys.filter(k => (childInt[k] + childExt[k]) > 0);
      const avgChildInt = monthsWithChild.length ? sum(monthsWithChild.map(k => childInt[k])) / monthsWithChild.length : 0;
      const avgChildExt = monthsWithChild.length ? sum(monthsWithChild.map(k => childExt[k])) / monthsWithChild.length : 0;

      const newInt = zerosFor(monthKeys);
      const newExt = zerosFor(monthKeys);
      const newIH = zerosFor(monthKeys);
      const newEH = zerosFor(monthKeys);
      for (const k of monthKeys) {
        if ((childInt[k] || 0) + (childExt[k] || 0) > 0) {
          newInt[k] = 0; newExt[k] = 0; newIH[k] = 0; newEH[k] = 0;
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

    const normalizedFeatures = feats.map(f => {
      const lastMk = f.monthsCovered.length ? f.monthsCovered[f.monthsCovered.length - 1] : monthKeys[monthKeys.length - 1];
      const roundMap = (src, total) => {
        const out = {};
        for (const k of monthKeys) out[k] = +((src[k] || 0).toFixed(2));
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

      return {
        id: f.id,
        name: f.title,
        state: '',
        values: { internal, external },
        hours: { internal: hoursI, external: hoursE },
        internalTotal: +(sum(Object.values(internal)).toFixed(2)),
        externalTotal: +(sum(Object.values(external)).toFixed(2)),
        total,
        internalHoursTotal: +(sum(Object.values(hoursI)).toFixed(2)),
        externalHoursTotal: +(sum(Object.values(hoursE)).toFixed(2)),
        totalHours,
        start: f.start,
        end: f.end,
        monthsCovered: f.monthsCovered,
        // Preserve original Epic totals for deviation comparison
        originalTotal: f.originalTotal,
        originalTotalHours: f.originalTotalHours
      };
    });

    const allChildIds = new Set([].concat(...Array.from(childrenMap.values()).map(a => a.map(String))));
    const totals = { internal: zerosFor(monthKeys), external: zerosFor(monthKeys), hours: { internal: zerosFor(monthKeys), external: zerosFor(monthKeys) } };
    let projectTotal = 0, projectTotalHours = 0;
    for (const f of normalizedFeatures) {
      if (allChildIds.has(String(f.id))) continue;
      for (const k of monthKeys) { totals.internal[k] += f.values.internal[k] || 0; totals.external[k] += f.values.external[k] || 0; totals.hours.internal[k] += f.hours.internal[k] || 0; totals.hours.external[k] += f.hours.external[k] || 0; }
      projectTotal += f.total; projectTotalHours += f.totalHours;
    }

    return { id: p.id, name: p.name, features: normalizedFeatures, totals, total: +projectTotal.toFixed(2), totalHours: +projectTotalHours.toFixed(2) };
  });

  const footerHours = { internal: zerosFor(months.map(monthKey)), external: zerosFor(months.map(monthKey)) };
  let footerTotalHours = 0;
  for (const p of projectsOut) {
    for (const k of Object.keys(p.totals.hours.internal)) footerHours.internal[k] += p.totals.hours.internal[k] || 0;
    for (const k of Object.keys(p.totals.hours.external)) footerHours.external[k] += p.totals.hours.external[k] || 0;
    footerTotalHours += +p.totalHours;
  }

  return { projects: projectsOut, footerHours, footerTotalHours };
};

export { toDate, firstOfMonth, lastOfMonth, addMonths, monthKey, monthLabel, buildMonths, buildProjects };
