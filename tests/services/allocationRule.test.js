import { describe, expect, it } from 'vitest';
import cases from '../fixtures/allocation_rule/cases.json';
import { resolveEffectiveAllocations } from '../../www/js/application/shared/allocationRule.js';

describe('lowest-level-wins allocation rule', () => {
  it('resolves deep trees without recursive traversal', () => {
    const features = Array.from({ length: 5000 }, (_, index) => ({
      id: String(index), parentId: index === 0 ? null : String(index - 1),
      start: '2025-01-01', end: '2025-01-31',
      capacity: index === 0 || index === 4999 ? [{ team: 'A', capacity: 20 }] : [],
    }));
    const result = resolveEffectiveAllocations(features);
    expect(result.get('0')).toEqual([]);
    expect(result.get('4999')).toEqual([{ team: 'A', capacity: 20 }]);
  });

  for (const fixture of cases) {
    it(fixture.name, () => {
      const original = structuredClone(fixture.features);
      if (fixture.error !== undefined) {
        expect(() => resolveEffectiveAllocations(fixture.features)).toThrow(fixture.error);
      } else {
        expect(Object.fromEntries(resolveEffectiveAllocations(fixture.features))).toEqual(fixture.expected);
        expect(Object.fromEntries(resolveEffectiveAllocations([...fixture.features].reverse())))
          .toEqual(fixture.expected);
      }
      expect(fixture.features).toEqual(original);
    });
  }
});