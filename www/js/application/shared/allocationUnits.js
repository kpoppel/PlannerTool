import { hasValidAllocationSpan } from './allocationRule.js';
import { ceilAllocation } from './teamAllocation.js';

const DAY_MS = 86400000;

export function countWorkingDays(feature) {
  if (!hasValidAllocationSpan(feature)) return 0;
  const start = new Date(feature.start);
  const days = Math.round((Date.parse(feature.end) - start.getTime()) / DAY_MS) + 1;
  let working = Math.floor(days / 7) * 5;
  for (let offset = 0; offset < days % 7; offset++) {
    const weekday = (start.getUTCDay() + offset) % 7;
    if (weekday !== 0 && weekday !== 6) working++;
  }
  return working;
}

export function normalizeStaffing(metadata) {
  const staffing = Object.create(null);
  // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
  for (const collection of [metadata.teams, metadata.groups]) {
    if (collection === null || typeof collection !== 'object' || collection instanceof Array) {
      throw new Error('Invalid allocation staffing metadata');
    }
    for (const [id, basis] of Object.entries(collection)) {
      if (Object.hasOwn(staffing, id)) throw new Error(`Duplicate staffing identity: ${id}`);
      if (basis === null || typeof basis !== 'object'
        || basis.internal === null || typeof basis.internal !== 'object'
        || basis.external === null || typeof basis.external !== 'object') {
        throw new Error(`Invalid staffing basis: ${id}`);
      }
      const internal = basis.internal.fte;
      const external = basis.external.fte;
      if (!Number.isFinite(internal) || !Number.isFinite(external)
        || internal < 0 || external < 0 || !Number.isFinite(internal + external)) {
        throw new Error(`Invalid staffing FTE: ${id}`);
      }
      staffing[id] = internal + external;
    }
  }
  return staffing;
}

export function getAllocationBasis(teamId, feature, staffing) {
  const fte = Object.hasOwn(staffing, teamId) ? staffing[teamId] : 0;
  const days = countWorkingDays(feature);
  const reason = fte <= 0 ? 'Team staffing is missing or zero'
    : days === 0 ? 'Schedule has no valid working days' : '';
  return { fte, days, max: fte * days, reason };
}

export function percentToManDays(percent, fte, days) {
  return percent / 100 * fte * days;
}

export function manDaysToPercent(manDays, fte, days) {
  if (!Number.isInteger(manDays) || manDays < 0 || fte <= 0 || days <= 0
    || manDays > fte * days) {
    throw new Error('Man-days must be whole numbers within the staffed working-day capacity');
  }
  return manDays / (fte * days) * 100;
}

export function formatManDays(value) {
  return String(ceilAllocation(value));
}

export function resizeAllocations(before, after, staffing) {
  const capacity = [];
  const removed = [];
  const oldDays = countWorkingDays(before);
  for (const row of before.capacity) {
    const basis = getAllocationBasis(row.team, after, staffing);
    const reason = basis.reason !== '' ? basis.reason
      : oldDays === 0 ? 'Previous schedule has no valid working days' : '';
    if (reason !== '') {
      removed.push({ team: row.team, reason });
      continue;
    }
    const rawPercent = row.capacity * oldDays / basis.days;
    if (rawPercent > 100 + Number.EPSILON * 100 * 2) {
      removed.push({ team: row.team, reason: 'Preserved man-days would exceed 100%' });
      continue;
    }
    capacity.push({ team: row.team, capacity: Math.min(rawPercent, 100) });
  }
  return { capacity, removed };
}