import {
  featureCanPresent, featureHasEligibleParent, featureMatchesPlans,
} from '../application/shared/featureProjection.js';

export const DEFAULT_SCOPES = Object.freeze([
  Object.freeze({ endMonth: 6, lower: -10, upper: 30 }),
  Object.freeze({ endMonth: 18, lower: -25, upper: 75 }),
  Object.freeze({ endMonth: 48, lower: -40, upper: 150 }),
]);

const DAY = 86400000;

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return date;
}

export function addMonths(value, months) {
  const date = value instanceof Date ? new Date(value.getTime()) : parseDate(value);
  if (date === null || !Number.isInteger(months)) throw new Error('Invalid forecast date or months');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  date.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  if (!Number.isFinite(date.getTime())) throw new Error('Forecast horizon exceeds supported dates');
  return date;
}

export function validateScopes(scopes) {
  // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
  if (!(scopes instanceof Array) || scopes.length !== 3) {
    throw new Error('Define exactly three uncertainty scopes.');
  }
  let previous = 0;
  for (const scope of scopes) {
    if (scope === null || typeof scope !== 'object'
      || !Number.isSafeInteger(scope.endMonth) || scope.endMonth <= previous) {
      throw new Error('Scope end months must be increasing positive whole numbers.');
    }
    if (!Number.isFinite(scope.lower) || scope.lower < -100 || scope.lower > 0
      || !Number.isFinite(scope.upper) || scope.upper < 0) {
      throw new Error('Lower uncertainty must be -100% to 0%; upper must be 0% or greater.');
    }
    addMonths('2000-01-01', scope.endMonth);
    previous = scope.endMonth;
  }
}

export function selectPlanTasks(features, planIds, rootsOnly, search) {
  const selectedIds = new Set(planIds.map(String));
  const tasks = features.filter((feature) => feature.ancestorOnly !== true
    && featureMatchesPlans(feature, selectedIds) && featureCanPresent(feature, selectedIds));
  const byId = new Map(tasks.map((feature) => [String(feature.id), feature]));
  const query = search.trim().toLowerCase();
  return tasks.filter((feature) => {
    const parent = byId.get(String(feature.parentId));
    if (rootsOnly && parent !== undefined && featureHasEligibleParent(feature, parent)) return false;
    return `${feature.id} ${feature.title}`.toLowerCase().includes(query);
  }).sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

/** Inclusive calendar-day durations; these are forecast ranges, not probabilities. */
export function buildForecast(features, originValue, scopes) {
  validateScopes(scopes);
  const origin = parseDate(originValue);
  if (origin === null) throw new Error('Choose a valid forecast origin date.');
  let axisStart = addMonths(origin, -3);
  const boundaries = [origin, ...scopes.map((scope) => addMonths(origin, scope.endMonth))];
  const horizon = boundaries[3];
  let maxEnd = horizon.getTime();
  let invalidCount = 0;
  let outsideCount = 0;
  const rows = [];
  for (const feature of features) {
    const start = parseDate(feature.start);
    const end = parseDate(feature.end);
    if (start === null || end === null || end < start) {
      invalidCount += 1;
      continue;
    }
    if (end < origin || start >= horizon) {
      outsideCount += 1;
      continue;
    }
    if (start < axisStart) axisStart = start;
    const activeBeforeOrigin = start < origin && feature.stateCategory === 'InProgress';
    const forecastStart = activeBeforeOrigin ? origin : start;
    const scopeIndex = activeBeforeOrigin ? 0 : start < origin ? -1
      : boundaries.findIndex((boundary, index) => index > 0 && start < boundary) - 1;
    let earliest = null;
    let latest = null;
    if (scopeIndex >= 0) {
      const duration = (end.getTime() - forecastStart.getTime()) / DAY + 1;
      const scope = scopes[scopeIndex];
      // Apply the delta before rounding so 100 days at -90% stays 10 days.
      const earlyDays = Math.max(1, Math.floor(duration + duration * scope.lower / 100));
      const lateDays = Math.max(1, Math.ceil(duration + duration * scope.upper / 100));
      earliest = new Date(forecastStart.getTime() + (earlyDays - 1) * DAY);
      latest = new Date(forecastStart.getTime() + (lateDays - 1) * DAY);
      if (!Number.isFinite(latest.getTime())) {
        throw new Error(`Uncertainty range exceeds supported dates for task ${feature.id}.`);
      }
    }
    maxEnd = Math.max(maxEnd, end.getTime(), latest === null ? 0 : latest.getTime());
    rows.push({ feature, start, forecastStart, end, earliest, latest, scopeIndex });
  }
  return {
    rows, invalidCount, outsideCount, boundaries, origin, axisStart, horizon,
    rangeEnd: new Date(maxEnd + DAY),
  };
}
