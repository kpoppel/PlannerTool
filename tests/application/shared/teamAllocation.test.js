import { describe, expect, it } from 'vitest';
import {
  buildDescendantAllocationTeams,
  computeFeatureOrgLoad,
  expandAllocationFocusIds,
  getCapacityTeamId,
  hasFeatureTeamAllocation,
  hasFeatureTeamId,
} from '../../../www/js/application/shared/teamAllocation.js';

describe('application/shared/teamAllocation', () => {
  it.each([
    ['unallocated child', { capacity: [] }, []],
    ['allocated child', {}, ['A', 'G']],
    ['another team', { capacity: [{ team: 'B', capacity: 25 }] }, ['B']],
    ['undated child', { start: null, end: null }, []],
    ['partially dated child', { end: null }, []],
    ['reversed dates', { start: '2026-02-01' }, []],
    ['removed child', { stateCategory: 'Removed' }, []],
    ['task child', { type: 'Task' }, []],
  ])('collects eligible descendant allocations: %s', (label, overrides, expected) => {
    const features = [
      { id: 'parent', capacity: [] },
      { id: 'child', type: 'Feature', start: '2026-01-01', end: '2026-01-15',
        capacity: [{ team: 'A', capacity: 25 }], ...overrides },
    ];
    const catalogue = [{ id: 'A', kind: 'team', group_id: 'G' }];
    const result = buildDescendantAllocationTeams(features,
      new Map([['parent', ['child']]]), catalogue);
    expect([...result.get('parent')]).toEqual(expected);
  });

  it('finds allocations through unallocated intermediate descendants', () => {
    const features = [
      { id: 'parent', capacity: [] },
      { id: 'child', capacity: [] },
      { id: 'grandchild', start: '2026-01-01', end: '2026-01-15',
        capacity: [{ team: 'A', capacity: 25 }] },
    ];
    const result = buildDescendantAllocationTeams(features,
      new Map([['parent', ['child']], ['child', ['grandchild']]]), []);
    expect([...result.get('parent')]).toEqual(['A']);
    expect([...result.get('child')]).toEqual(['A']);
  });

  it('rejects a cyclic allocation hierarchy', () => {
    expect(() => buildDescendantAllocationTeams([{ id: 'parent' }, { id: 'child' }],
      new Map([['parent', ['child']], ['child', ['parent']]]), []))
      .toThrow('Allocation hierarchy contains a cycle');
  });

  it('computes organization load from member expansion and does not charge unknown or empty groups', () => {
    const roster = new Set(['A', 'B']);
    const groups = new Map([['G', ['A', 'B']], ['empty', []]]);
    const feature = { capacity: [{ team: 'G', capacity: 50 }, { team: 'None', capacity: 20 }] };
    expect(computeFeatureOrgLoad(feature, roster, groups)).toBe('50%');
    expect(computeFeatureOrgLoad({ capacity: [{ team: 'empty', capacity: 50 }] }, roster, groups))
      .toBe('0%');
  });
  it('ceils organization-load labels without displaying positive allocations as zero', () => {
    const roster = new Set(['A', 'B']);
    expect(computeFeatureOrgLoad({ capacity: [{ team: 'A', capacity: 20.2 }] }, roster)).toBe('11%');
    expect(computeFeatureOrgLoad({ capacity: [{ team: 'A', capacity: 0.001 }] }, roster)).toBe('1%');
    expect(computeFeatureOrgLoad({ capacity: [{ team: 'A', capacity: 20 + Number.EPSILON * 20 }] }, roster))
      .toBe('10%');
    expect(computeFeatureOrgLoad({ capacity: [{ team: 'A', capacity: 0 }] }, roster)).toBe('0%');
    expect(computeFeatureOrgLoad({ capacity: [] }, new Set())).toBe('0%');
  });
  it('expands group focus to members without making member focus include sibling-only work', () => {
    const catalogue = [
      { id: 'A', kind: 'team', group_id: 'G', archived: false },
      { id: 'B', kind: 'team', group_id: 'G', archived: true },
      { id: 'G', kind: 'group', archived: false },
    ];
    expect([...expandAllocationFocusIds(new Set(['G']), catalogue)].sort()).toEqual(['A', 'B', 'G']);
    const memberFocus = expandAllocationFocusIds(new Set(['A']), catalogue);
    expect([...memberFocus].sort()).toEqual(['A', 'G']);
    expect(hasFeatureTeamAllocation({ capacity: [{ team: 'G', capacity: 50 }] }, memberFocus)).toBe(true);
    expect(hasFeatureTeamAllocation({ capacity: [{ team: 'B', capacity: 50 }] }, memberFocus)).toBe(false);
  });
  it('returns the contract team field from a capacity entry', () => {
    expect(getCapacityTeamId({ team: 't1', capacity: 50 })).toBe('t1');
  });

  it('matches selected team ids against feature capacities', () => {
    const feature = {
      id: 'f1',
      capacity: [
        { team: '42', capacity: 50 },
        { team: '99', capacity: 25 },
      ],
    };
    expect(hasFeatureTeamAllocation(feature, new Set(['42']))).toBe(true);
    expect(hasFeatureTeamAllocation(feature, new Set(['99']))).toBe(true);
    expect(hasFeatureTeamAllocation(feature, new Set(['x']))).toBe(false);
  });

  it('supports single-team convenience checks', () => {
    const feature = {
      id: 'f1',
      capacity: [{ team: '123', capacity: 100 }],
    };
    expect(hasFeatureTeamId(feature, '123')).toBe(true);
    expect(hasFeatureTeamId(feature, '999')).toBe(false);
  });
});
