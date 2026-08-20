import { describe, expect, it } from 'vitest';
import {
  getCapacityTeamId,
  hasFeatureTeamAllocation,
  hasFeatureTeamId,
} from '../../www/js/application/shared/teamAllocation.js';

describe('application/shared/teamAllocation', () => {
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
