import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/allocation_rule/availability.json';
import {
  projectAllocationAvailability, validateAllocationChange,
} from '../../www/js/application/shared/allocationAvailability.js';

describe('canonical allocation availability', () => {
  const project = (feature) => projectAllocationAvailability({
    feature, projects: fixture.projects, catalogue: fixture.catalogue,
    allocationDefaults: fixture.defaults,
  });

  for (const test of fixture.cases) {
    it(test.name, () => {
      const feature = { id: 'item', project: test.owner, capacity: test.capacity,
        sourcePlanIds: ['inherit'], type: 'not-the-container-type' };
      const original = structuredClone(feature);
      expect(project(feature)).toEqual({ allowed_ids: test.allowed, existing: test.existing });
      expect(feature).toEqual(original);
    });
  }

  it('allows edits to retained unavailable allocations, but not re-addition after removal', () => {
    const feature = { id: 'item', project: 'empty', capacity: [{ team: 'old', capacity: 40 }] };
    expect(() => validateAllocationChange(project(feature), [{ team: 'old', capacity: 70 }])).not.toThrow();
    expect(() => validateAllocationChange(project(feature), [])).not.toThrow();
    expect(() => validateAllocationChange(project({ ...feature, capacity: [] }),
      [{ team: 'old', capacity: 40 }])).toThrow('old');
  });

  it('rejects invalid values, duplicate IDs and unknown configuration references', () => {
    const availability = project({ id: 'item', project: 'inherit', capacity: [] });
    for (const capacity of [
      [{ team: 'A', capacity: -1 }], [{ team: 'A', capacity: 101 }],
      [{ team: 'A', capacity: NaN }], [{ team: 'A', capacity: '20' }],
      [{ team: 'A', capacity: 20 }, { team: 'A', capacity: 30 }],
    ]) expect(() => validateAllocationChange(availability, capacity)).toThrow();
    expect(() => projectAllocationAvailability({ feature: { project: 'inherit', capacity: [] },
      projects: fixture.projects, catalogue: fixture.catalogue,
      allocationDefaults: { ...fixture.defaults, Plan: ['missing'] } })).toThrow('missing');
  });

  it('retains duplicate unknown rows unchanged while allowing known-team edits', () => {
    const capacity = [{ team: 'None', capacity: 20 }, { team: 'None', capacity: 20 }];
    const availability = project({ project: 'inherit', capacity });
    expect(() => validateAllocationChange(availability,
      [...capacity, { team: 'A', capacity: 60 }])).not.toThrow();
    for (const invalid of [
      [...capacity, { team: 'None', capacity: 20 }],
      [{ team: 'None', capacity: 30 }, capacity[1]], [capacity[0]], [],
    ]) expect(() => validateAllocationChange(availability, invalid)).toThrow('Unresolved duplicate');
  });
});