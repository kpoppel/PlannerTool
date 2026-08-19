import { describe, expect, it } from 'vitest';
import {
  getCapacityTeamId,
  hasFeatureTeamAllocation,
  hasFeatureTeamId,
} from '../../www/js/application/shared/teamAllocation.js';

describe('application/shared/teamAllocation', () => {
  it('returns the contract teamId field from a capacity entry', () => {
    expect(getCapacityTeamId({ teamId: 't1' })).toBe('t1');
  });

  it('matches selected team ids against feature capacities', () => {
    const feature = {
      id: 'f1',
      capacity: [{ teamId: '42' }, { teamId: '99' }],
    };
    expect(hasFeatureTeamAllocation(feature, new Set(['42']))).toBe(true);
    expect(hasFeatureTeamAllocation(feature, new Set(['99']))).toBe(true);
    expect(hasFeatureTeamAllocation(feature, new Set(['x']))).toBe(false);
  });

  it('supports single-team convenience checks', () => {
    const feature = {
      id: 'f1',
      capacity: [{ teamId: '123' }],
    };
    expect(hasFeatureTeamId(feature, '123')).toBe(true);
    expect(hasFeatureTeamId(feature, '999')).toBe(false);
  });
});
