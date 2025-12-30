// Minimalist, single-pass PluginCostCalculator.js
import { isEnabled } from '../config.js';

const toDate = d => new Date(`${d}T00:00:00Z`);
const firstOfMonth = dt => new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
const lastOfMonth = dt => new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
const addMonths = (dt, n) => new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + n, 1));
const monthKey = dt => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = dt => dt.toLocaleString(undefined, { month: 'short', year: 'numeric' });

const buildMonths = ({ dataset_start, dataset_end }) => {
  const start = firstOfMonth(toDate(dataset_start));
  const end = firstOfMonth(toDate(dataset_end));
  const out = [];
  for (let cur = start; cur <= end; cur = addMonths(cur, 1)) out.push(new Date(cur));
  return out;
};

const zerosFor = keys => Object.fromEntries(keys.map(k => [k, 0]));
const sum = arr => arr.reduce((a, b) => a + b, 0);

const overlapDays = (start, end, mStart) => {
  const mEnd = lastOfMonth(mStart);
  const s = start > mStart ? start : mStart;
  const e = end < mEnd ? end : mEnd;
  if (e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1;
};

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

const buildProjects = (projects, months, state) => {
  const monthKeys = months.map(monthKey);
  const useEpicGapFills = isEnabled('USE_EPIC_CAPACITY_GAP_FILLS');

  const projectsOut = (projects || []).map(p => {
    const feats = (p.features || []).map(f => buildFeature(f, monthKeys, months));
    const featById = new Map(feats.map(f => [f.id, f]));

    const childrenMap = new Map();
    if (state && state.childrenByEpic && typeof state.childrenByEpic.get === 'function') {
      for (const f of p.features || []) {
        const raw = state.childrenByEpic.get(Number(f.id)) || state.childrenByEpic.get(String(f.id)) || [];
        if (raw && raw.length) childrenMap.set(String(f.id), raw.map(String));
      }
    } else {
      for (const f of p.features || []) if (f.parentEpic || f.parentEpic === 0) childrenMap.set(String(f.parentEpic), (childrenMap.get(String(f.parentEpic)) || []).concat(String(f.id)));
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
        for (const k of Object.keys(c.valuesInternal)) childInt[k] += c.valuesInternal[k] || 0;
        for (const k of Object.keys(c.valuesExternal)) childExt[k] += c.valuesExternal[k] || 0;
        for (const k of Object.keys(c.hoursInternal)) childIH[k] += c.hoursInternal[k] || 0;
        for (const k of Object.keys(c.hoursExternal)) childEH[k] += c.hoursExternal[k] || 0;
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
        monthsCovered: f.monthsCovered
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
