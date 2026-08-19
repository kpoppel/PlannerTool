import { describe, expect, it } from 'vitest';
import {
  applyGroupOverrides,
  deriveEffectiveGroupsForPlan,
  derivePendingGroupChanges,
} from '../../www/js/application/shared/groupProjection.js';

describe('application/shared/groupProjection', () => {
  it('applies member deltas and scalar overrides to baseline groups', () => {
    const groups = [{ id: 'g1', plan_id: 'p1', name: 'Core', members: ['f1'] }];
    const overrides = {
      g1: {
        name: 'Core+Ops',
        memberDeltas: [{ taskId: 'f2', op: 'add' }],
      },
    };

    const result = applyGroupOverrides(groups, overrides);
    expect(result).toEqual([
      { id: 'g1', plan_id: 'p1', name: 'Core+Ops', members: ['f1', 'f2'] },
    ]);
  });

  it('derives effective groups by combining overrides with scenario-local groups', () => {
    const baseline = [{ id: 'g1', plan_id: 'p1', name: 'Core', members: ['f1'] }];
    const scenario = {
      groupOverrides: { g1: { memberDeltas: [{ taskId: 'f2', op: 'add' }] } },
      scenarioGroups: [{ id: 'tmp_1', plan_id: 'p1', name: 'Draft', members: [] }],
    };

    const result = deriveEffectiveGroupsForPlan('p1', baseline, scenario);
    expect(result.map((group) => group.id)).toEqual(['g1', 'tmp_1']);
    expect(result[0].members).toEqual(['f1', 'f2']);
  });

  it('derives pending create/update/delete group changes', () => {
    const scenario = {
      scenarioGroups: [{ id: 'tmp_1', plan_id: 'p1' }],
      groupOverrides: {
        g1: { name: 'Renamed' },
        g2: { _deleted: true },
      },
    };

    const pending = derivePendingGroupChanges(scenario);
    expect(pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create', group: expect.objectContaining({ id: 'tmp_1' }) }),
        expect.objectContaining({ type: 'update', groupId: 'g1' }),
        expect.objectContaining({ type: 'delete', groupId: 'g2' }),
      ])
    );
  });
});
