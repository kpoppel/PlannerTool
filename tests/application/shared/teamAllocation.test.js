import { describe, expect, it } from 'vitest';
import {
  computeFeatureOrgLoad,
  expandAllocationFocusIds,
  getCapacityTeamId,
  hasFeatureTeamAllocation,
  hasFeatureTeamId,
} from '../../../www/js/application/shared/teamAllocation.js';

describe('application/shared/teamAllocation', () => {
  it('computes organization load from member expansion and does not charge unknown or empty groups', () => {
    const roster = new Set(['A', 'B']);
    const groups = new Map([['G', ['A', 'B']], ['empty', []]]);
    const feature = { capacity: [{ team: 'G', capacity: 50 }, { team: 'None', capacity: 20 }] };
    expect(computeFeatureOrgLoad(feature, roster, groups)).toBe('50.0%');
    expect(computeFeatureOrgLoad({ capacity: [{ team: 'empty', capacity: 50 }] }, roster, groups))
      .toBe('0.0%');
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
