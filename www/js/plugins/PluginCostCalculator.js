// PluginCostCalculator.js
// Extracted calculation helpers from PluginCostComponent
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

const sum = arr => arr.reduce((a, b) => a + b, 0);

const buildFeature = (f, monthKeys, months) => {
  const start = toDate(f.start || f.start_date || f.starts_at);
  const end = toDate(f.end || f.end_date || f.ends_at);
  const internalTotal = f.metrics.internal.cost;
  const externalTotal = f.metrics.external.cost;
  const internalHoursTotal = f.metrics.internal.hours;
  const externalHoursTotal = f.metrics.external.hours;

  const sMonth = firstOfMonth(start);
  const eMonth = firstOfMonth(end);
  const monthsCovered = [];
  for (let cur = new Date(sMonth); cur <= eMonth; cur = addMonths(cur, 1)) monthsCovered.push(monthKey(cur));

  const zeros = Object.fromEntries(monthKeys.map(k => [k, 0]));
  const internalValues = { ...zeros };
  const externalValues = { ...zeros };
  const internalHoursValues = { ...zeros };
  const externalHoursValues = { ...zeros };

  const monthStartMap = Object.fromEntries(months.map(m => [monthKey(m), firstOfMonth(m)]));
  const msPerDay = 24 * 60 * 60 * 1000;

  const daysByMonth = {};
  let totalDays = 0;
  for (const mk of monthsCovered) {
    const mStart = monthStartMap[mk];
    const mEnd = lastOfMonth(mStart);
    const overlapStart = start > mStart ? start : mStart;
    const overlapEnd = end < mEnd ? end : mEnd;
    const days = Math.max(0, Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / msPerDay) + 1);
    daysByMonth[mk] = days;
    totalDays += days;
  }

  if (totalDays > 0) {
    const perDayInternal = internalTotal / totalDays;
    const perDayExternal = externalTotal / totalDays;
    const perDayInternalHours = internalHoursTotal / totalDays;
    const perDayExternalHours = externalHoursTotal / totalDays;
    for (const mk of monthsCovered) {
      internalValues[mk] = +((perDayInternal * (daysByMonth[mk] || 0)).toFixed(2));
      externalValues[mk] = +((perDayExternal * (daysByMonth[mk] || 0)).toFixed(2));
      internalHoursValues[mk] = +((perDayInternalHours * (daysByMonth[mk] || 0)).toFixed(2));
      externalHoursValues[mk] = +((perDayExternalHours * (daysByMonth[mk] || 0)).toFixed(2));
    }
  } else {
    const perMonthInternal = internalTotal / monthsCovered.length;
    const perMonthExternal = externalTotal / monthsCovered.length;
    const perMonthInternalHours = internalHoursTotal / monthsCovered.length;
    const perMonthExternalHours = externalHoursTotal / monthsCovered.length;
    for (const mk of monthsCovered) {
      internalValues[mk] = +perMonthInternal.toFixed(2);
      externalValues[mk] = +perMonthExternal.toFixed(2);
      internalHoursValues[mk] = +perMonthInternalHours.toFixed(2);
      externalHoursValues[mk] = +perMonthExternalHours.toFixed(2);
    }
  }

  const adjustLast = (values, total) => {
    const sumVals = sum(Object.values(values));
    if (monthsCovered.length && Math.abs(sumVals - total) > 0.001) {
      const last = monthsCovered[monthsCovered.length - 1];
      values[last] = +(values[last] + (total - sumVals)).toFixed(2);
    }
  };

  adjustLast(internalValues, internalTotal);
  adjustLast(externalValues, externalTotal);
  adjustLast(internalHoursValues, internalHoursTotal);
  adjustLast(externalHoursValues, externalHoursTotal);

  const total = +(internalTotal + externalTotal).toFixed(2);
  const totalHours = +(internalHoursTotal + externalHoursTotal).toFixed(2);

  return {
    id: String(f.id),
    name: f.title || f.name || String(f.id),
    state: f.state || f.status || '',
    values: { internal: internalValues, external: externalValues },
    hours: { internal: internalHoursValues, external: externalHoursValues },
    internalTotal,
    externalTotal,
    total,
    internalHoursTotal,
    externalHoursTotal,
    totalHours,
    start: f.start,
    end: f.end,
    monthsCovered,
    metrics: f.metrics,
    capacity: f.capacity,
    description: f.description || '',
    url: f.url || ''
  };
};

const buildProjects = (projects, months, state) => {
  const monthKeys = months.map(monthKey);
  const useEpicGapFills = isEnabled('USE_EPIC_CAPACITY_GAP_FILLS');

  const childrenFor = id => (state && state.childrenByEpic && typeof state.childrenByEpic.get === 'function') ? (state.childrenByEpic.get(Number(id)) || state.childrenByEpic.get(String(id)) || state.childrenByEpic.get(id) || []) : [];

  const projectsOut = projects.map(p => {
    const featsPre = p.features.map(f => buildFeature(f, monthKeys, months));
    const featById = new Map(featsPre.map(f => [f.id, f]));

    const feats = featsPre.map(fObj => {
      const childrenRaw = childrenFor(fObj.id);
      const childrenIds = childrenRaw.length ? childrenRaw.map(String) : p.features.filter(r => String(r.parentEpic) === String(fObj.id)).map(r => String(r.id));
      if (!childrenIds.length) return fObj;

      const children = childrenIds.map(id => featById.get(String(id))).filter(Boolean);

      if (!useEpicGapFills) {
        const childMonthlyInternal = Object.fromEntries(monthKeys.map(k => [k, 0]));
        const childMonthlyExternal = Object.fromEntries(monthKeys.map(k => [k, 0]));
        const childMonthlyIntH = Object.fromEntries(monthKeys.map(k => [k, 0]));
        const childMonthlyExtH = Object.fromEntries(monthKeys.map(k => [k, 0]));
        for (const c of children) {
          for (const k of Object.keys(c.values.internal)) childMonthlyInternal[k] += c.values.internal[k];
          for (const k of Object.keys(c.values.external)) childMonthlyExternal[k] += c.values.external[k];
          for (const k of Object.keys(c.hours.internal)) childMonthlyIntH[k] += c.hours.internal[k];
          for (const k of Object.keys(c.hours.external)) childMonthlyExtH[k] += c.hours.external[k];
        }
        const finalInternalTotal = +sum(Object.values(childMonthlyInternal)).toFixed(2);
        const finalExternalTotal = +sum(Object.values(childMonthlyExternal)).toFixed(2);
        const finalTotal = +(finalInternalTotal + finalExternalTotal).toFixed(2);
        const finalIntHTotal = +sum(Object.values(childMonthlyIntH)).toFixed(2);
        const finalExtHTotal = +sum(Object.values(childMonthlyExtH)).toFixed(2);
        const finalTotalHours = +(finalIntHTotal + finalExtHTotal).toFixed(2);
        return { ...fObj, values: { internal: childMonthlyInternal, external: childMonthlyExternal }, hours: { internal: childMonthlyIntH, external: childMonthlyExtH }, internalTotal: finalInternalTotal, externalTotal: finalExternalTotal, total: finalTotal, internalHoursTotal: finalIntHTotal, externalHoursTotal: finalExtHTotal, totalHours: finalTotalHours };
      }

      // useEpicGapFills === true
      const childMonthlyInternal = Object.fromEntries(monthKeys.map(k => [k, 0]));
      const childMonthlyExternal = Object.fromEntries(monthKeys.map(k => [k, 0]));
      for (const c of children) {
        for (const k of Object.keys(c.values.internal)) childMonthlyInternal[k] += c.values.internal[k];
        for (const k of Object.keys(c.values.external)) childMonthlyExternal[k] += c.values.external[k];
      }

      const epicMonths = fObj.monthsCovered;
      let childInternalSum = 0, childExternalSum = 0, monthsWithChildren = 0;
      for (const k of epicMonths) {
        const ci = childMonthlyInternal[k];
        const ce = childMonthlyExternal[k];
        if (ci + ce > 0) { childInternalSum += ci; childExternalSum += ce; monthsWithChildren++; }
      }
      const avgChildInternal = monthsWithChildren ? (childInternalSum / monthsWithChildren) : 0;
      const avgChildExternal = monthsWithChildren ? (childExternalSum / monthsWithChildren) : 0;

      const epicInternalValues = { ...fObj.values.internal };
      const epicExternalValues = { ...fObj.values.external };

      const newInternal = Object.fromEntries(monthKeys.map(k => [k, 0]));
      const newExternal = Object.fromEntries(monthKeys.map(k => [k, 0]));
      for (const k of epicMonths) {
        const childSum = (childMonthlyInternal[k] || 0) + (childMonthlyExternal[k] || 0);
        if (childSum > 0) { newInternal[k] = 0; newExternal[k] = 0; }
        else { newInternal[k] = +(epicInternalValues[k] || avgChildInternal); newExternal[k] = +(epicExternalValues[k] || avgChildExternal); }
      }

      const finalInternalTotal = +sum(Object.values(newInternal)).toFixed(2);
      const finalExternalTotal = +sum(Object.values(newExternal)).toFixed(2);
      const finalTotal = +(finalInternalTotal + finalExternalTotal).toFixed(2);

      const childMonthlyIntH = Object.fromEntries(monthKeys.map(k => [k, 0]));
      const childMonthlyExtH = Object.fromEntries(monthKeys.map(k => [k, 0]));
      for (const c of children) { for (const k of Object.keys(c.hours.internal)) childMonthlyIntH[k] += c.hours.internal[k]; for (const k of Object.keys(c.hours.external)) childMonthlyExtH[k] += c.hours.external[k]; }
      let childIntHSum = 0, childExtHSum = 0, monthsWithChildH = 0;
      for (const k of epicMonths) { const ch = (childMonthlyIntH[k] || 0) + (childMonthlyExtH[k] || 0); if (ch > 0) { childIntHSum += (childMonthlyIntH[k] || 0); childExtHSum += (childMonthlyExtH[k] || 0); monthsWithChildH++; } }
      const avgChildIntH = monthsWithChildH ? (childIntHSum / monthsWithChildH) : 0;
      const avgChildExtH = monthsWithChildH ? (childExtHSum / monthsWithChildH) : 0;
      const newIntH = Object.fromEntries(monthKeys.map(k => [k, 0]));
      const newExtH = Object.fromEntries(monthKeys.map(k => [k, 0]));
      for (const k of epicMonths) { const ch = (childMonthlyIntH[k] || 0) + (childMonthlyExtH[k] || 0); if (ch > 0) { newIntH[k] = 0; newExtH[k] = 0; } else { newIntH[k] = +avgChildIntH; newExtH[k] = +avgChildExtH; } }
      const finalIntHTotal = +sum(Object.values(newIntH)).toFixed(2);
      const finalExtHTotal = +sum(Object.values(newExtH)).toFixed(2);
      const finalTotalHours = +(finalIntHTotal + finalExtHTotal).toFixed(2);

      return { ...fObj, values: { internal: newInternal, external: newExternal }, hours: { internal: newIntH, external: newExtH }, internalTotal: finalInternalTotal, externalTotal: finalExternalTotal, total: finalTotal, internalHoursTotal: finalIntHTotal, externalHoursTotal: finalExtHTotal, totalHours: finalTotalHours };
    });

    const totals = { internal: Object.fromEntries(monthKeys.map(k => [k, 0])), external: Object.fromEntries(monthKeys.map(k => [k, 0])), hours: { internal: Object.fromEntries(monthKeys.map(k => [k, 0])), external: Object.fromEntries(monthKeys.map(k => [k, 0])) } };
    let projectTotal = 0;
    let projectTotalHours = 0;

    const allChildIds = new Set();
    for (const raw of p.features) {
      if (raw.parentEpic === 0 || raw.parentEpic) allChildIds.add(String(raw.id));
      const children = childrenFor(raw.id);
      for (const c of children) allChildIds.add(String(c));
    }

    for (const f of feats) {
      if (allChildIds.has(String(f.id))) continue;
      for (const k of Object.keys(f.values.internal)) totals.internal[k] += f.values.internal[k];
      for (const k of Object.keys(f.values.external)) totals.external[k] += f.values.external[k];
      for (const k of Object.keys(f.hours.internal)) totals.hours.internal[k] += f.hours.internal[k];
      for (const k of Object.keys(f.hours.external)) totals.hours.external[k] += f.hours.external[k];
      projectTotal += f.total;
      projectTotalHours += f.totalHours;
    }

    return { id: p.id, name: p.name, features: feats, totals, total: +projectTotal.toFixed(2), totalHours: +projectTotalHours.toFixed(2) };
  });

  const footerHours = { internal: Object.fromEntries(monthKeys.map(k => [k, 0])), external: Object.fromEntries(monthKeys.map(k => [k, 0])) };
  let footerTotalHours = 0;
  for (const p of projectsOut) {
    for (const k of Object.keys(p.totals.hours.internal)) footerHours.internal[k] += p.totals.hours.internal[k];
    for (const k of Object.keys(p.totals.hours.external)) footerHours.external[k] += p.totals.hours.external[k];
    footerTotalHours += +p.totalHours;
  }

  return { projects: projectsOut, footerHours, footerTotalHours };
};

export { toDate, firstOfMonth, lastOfMonth, addMonths, monthKey, monthLabel, buildMonths, buildProjects };
