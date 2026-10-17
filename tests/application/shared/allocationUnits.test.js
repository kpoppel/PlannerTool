import { describe, expect, it } from 'vitest';
import {
  countWorkingDays, getAllocationBasis, manDaysToPercent, percentToManDays,
  formatManDays, resizeAllocations, normalizeStaffing,
} from '../../../www/js/application/shared/allocationUnits.js';

const span = { start: '2026-10-05', end: '2026-10-16' };
const staffing = { alpha: 5, beta: 2.5, group: 7.5, empty: 0 };

describe('allocation units', () => {
  it('uses inclusive weekdays and validates calendar dates', () => {
    expect(countWorkingDays(span)).toBe(10);
    expect(countWorkingDays({ start: '2026-10-05', end: '2026-10-05' })).toBe(1);
    expect(countWorkingDays({ start: '2026-10-10', end: '2026-10-11' })).toBe(0);
    expect(countWorkingDays({ start: null, end: null })).toBe(0);
    expect(countWorkingDays({ start: '2026-02-30', end: '2026-03-02' })).toBe(0);
    expect(countWorkingDays({ start: span.end, end: span.start })).toBe(0);
    expect(countWorkingDays({ start: '2024-02-28', end: '2024-03-01' })).toBe(3);
    expect(countWorkingDays({ start: '2026-03-27', end: '2026-03-30' })).toBe(2);
  });

  it('converts the requested example and fractional staffing', () => {
    expect(percentToManDays(20, 5, 10)).toBe(10);
    expect(manDaysToPercent(10, 5, 10)).toBe(20);
    expect(percentToManDays(20, 2.5, 10)).toBe(5);
    expect(manDaysToPercent(1, 5, 10)).toBe(2);
    expect(manDaysToPercent(1, 6, 10)).toBeCloseTo(100 / 60, 12);
    expect(formatManDays(10)).toBe('10');
    expect(formatManDays(1.234)).toBe('2');
    expect(formatManDays(1.5)).toBe('2');
    expect(formatManDays(0.01)).toBe('1');
    expect(formatManDays(0)).toBe('0');
  });

  it('rejects invalid direct input instead of clamping or dividing by zero', () => {
    for (const value of [-1, Infinity, NaN, 50.1, 1.4, 0.1]) {
      expect(() => manDaysToPercent(value, 5, 10)).toThrow();
    }
    expect(() => manDaysToPercent(1, 0, 10)).toThrow();
    expect(() => manDaysToPercent(1, 5, 0)).toThrow();
    expect(getAllocationBasis('missing', span, staffing).reason).toContain('staffing');
    expect(getAllocationBasis('empty', span, staffing).reason).toContain('staffing');
    expect(getAllocationBasis('alpha', { start: null, end: null }, staffing).reason)
      .toContain('working days');
  });

  it('cancels average project hours per person-day and permits a tighter Bluetooth schedule', () => {
    const feature = { start: '2026-06-17', end: '2026-08-04',
      capacity: [{ team: 'bluetooth', capacity: 15 }] };
    const projectStaffing = normalizeStaffing({ teams: { bluetooth: {
      internal: { fte: 6, monthly_hours: 696 }, external: { fte: 0, monthly_hours: 0 },
    } }, groups: {} });
    const basis = getAllocationBasis('bluetooth', feature, projectStaffing);
    expect(countWorkingDays(feature)).toBe(35);
    const averageWorkingDays = 5 * 52 / 12;
    const allocatedProjectHours = 0.15 * 696 * 35 / averageWorkingDays;
    const projectHoursPerPersonDay = (696 / 6) / averageWorkingDays;
    expect(allocatedProjectHours / projectHoursPerPersonDay).toBeCloseTo(31.5, 10);
    expect(basis.max).toBe(210);
    expect(percentToManDays(15, basis.fte, 35)).toBeCloseTo(31.5, 12);
    expect(formatManDays(percentToManDays(15, basis.fte, 35))).toBe('32');
    expect(percentToManDays(manDaysToPercent(100, basis.fte, 35), basis.fte, 35))
      .toBeCloseTo(100, 12);
    expect(formatManDays(percentToManDays(manDaysToPercent(100, basis.fte, 35), basis.fte, 35)))
      .toBe('100');
    expect(percentToManDays(manDaysToPercent(100, basis.fte, 34), basis.fte, 34))
      .toBeCloseTo(100, 12);
    const result = resizeAllocations(feature, { ...feature, end: '2026-07-14' }, projectStaffing);
    expect(result.removed).toEqual([]);
    expect(result.capacity[0].capacity).toBeCloseTo(26.25, 12);
  });

  it('keeps project person-days independent of the monthly project-hour budget', () => {
    for (const monthlyHours of [696, 900]) {
      const metadata = { teams: { alpha: {
        internal: { fte: 6, monthly_hours: monthlyHours }, external: { fte: 0, monthly_hours: 0 },
      } }, groups: {} };
      const basis = getAllocationBasis('alpha', span, normalizeStaffing(metadata));
      expect(basis.fte).toBe(6);
      expect(percentToManDays(20, basis.fte, basis.days)).toBeCloseTo(12, 10);
    }
  });

  it('preserves effort once using final working-day duration without mutating inputs', () => {
    const feature = { ...span, capacity: [{ team: 'alpha', capacity: 20 }] };
    const result = resizeAllocations(feature, { ...span, end: '2026-10-30' }, staffing);
    expect(result.capacity).toEqual([{ team: 'alpha', capacity: 10 }]);
    expect(result.removed).toEqual([]);
    expect(feature.capacity[0].capacity).toBe(20);
    expect(resizeAllocations(feature, { ...span, end: '2026-10-09' }, staffing).capacity)
      .toEqual([{ team: 'alpha', capacity: 40 }]);
  });

  it('reports over-capacity rows separately from unconvertible allocation removals', () => {
    const feature = { ...span, capacity: [
      { team: 'alpha', capacity: 20 }, { team: 'beta', capacity: 51 },
      { team: 'missing', capacity: 10 }, { team: 'empty', capacity: 0 },
    ] };
    const result = resizeAllocations(feature, { ...span, end: '2026-10-09' }, staffing);
    expect(result.capacity).toEqual([{ team: 'alpha', capacity: 40 }]);
    expect(result.removed.map((row) => row.team)).toEqual(['missing', 'empty']);
    expect(result.exceeded).toEqual([{ team: 'beta', capacity: 102 }]);
    const exact = { ...span, capacity: [{ team: 'alpha', capacity: 50 }] };
    expect(resizeAllocations(exact, { ...span, end: '2026-10-09' }, staffing).capacity[0].capacity)
      .toBe(100);
    const over = { ...span, capacity: [{ team: 'alpha', capacity: 50.1 }] };
    const overResult = resizeAllocations(over, { ...span, end: '2026-10-09' }, staffing);
    expect(overResult.removed).toEqual([]);
    expect(overResult.exceeded).toEqual([{ team: 'alpha', capacity: 100.2 }]);
  });

  it('clears unconvertible spans and preserves fractional effort through repeated resizing', () => {
    const feature = { ...span, capacity: [{ team: 'alpha', capacity: 1 }] };
    expect(resizeAllocations(feature, { start: null, end: null }, staffing).capacity).toEqual([]);
    expect(resizeAllocations({ ...feature, start: null }, span, staffing).capacity).toEqual([]);
    const result = resizeAllocations(feature, { ...span, end: '2026-10-28' }, staffing);
    expect(result.capacity[0].capacity).toBeCloseTo(10 / 18, 12);
    let current = feature;
    for (let iteration = 0; iteration < 20; iteration++) {
      const expanded = { ...span, end: '2036-10-16' };
      const stretched = resizeAllocations(current, expanded, staffing);
      expect(stretched.capacity[0].capacity).toBeGreaterThan(0);
      expect(stretched.capacity[0].capacity).toBeLessThan(0.01);
      expect(percentToManDays(stretched.capacity[0].capacity, 5, countWorkingDays(expanded)))
        .toBeCloseTo(0.5, 12);
      current = { ...span, capacity: resizeAllocations({ ...expanded, capacity: stretched.capacity }, span, staffing).capacity };
      expect(current.capacity[0].capacity).toBeCloseTo(1, 12);
    }
  });

  it('retains full allocation through stretch-and-restore at the 100 percent boundary', () => {
    const feature = { ...span, capacity: [{ team: 'alpha', capacity: 100 }] };
    for (let offset = 0; offset < 365; offset++) {
      const end = new Date(Date.parse(span.end) + offset * 86400000).toISOString().slice(0, 10);
      const extended = { ...span, end };
      const stretched = resizeAllocations(feature, extended, staffing);
      const restored = resizeAllocations({ ...extended, capacity: stretched.capacity }, span, staffing);
      expect(restored.removed).toEqual([]);
      expect(restored.capacity[0].capacity).toBeCloseTo(100, 12);
      expect(restored.capacity[0].capacity).toBeLessThanOrEqual(100);
    }
  });

  it('normalizes team and group FTE once without duplicating group members', () => {
    const basis = (internal, external) => ({ internal: { fte: internal }, external: { fte: external } });
    expect(normalizeStaffing({ teams: { alpha: basis(3, 2) }, groups: { group: basis(4, 3.5) } }))
      .toEqual({ alpha: 5, group: 7.5 });
    expect(() => normalizeStaffing({ teams: { alpha: basis(-1, 2) }, groups: {} })).toThrow();
    expect(() => normalizeStaffing({ teams: { alpha: basis(Infinity, 2) }, groups: {} })).toThrow();
    expect(() => normalizeStaffing({ teams: {}, groups: null })).toThrow();
    const specialIdentity = normalizeStaffing({ teams: { ['__proto__']: basis(1, 2) }, groups: {} });
    expect(Object.hasOwn(specialIdentity, '__proto__')).toBe(true);
    expect(specialIdentity['__proto__']).toBe(3);
  });
});