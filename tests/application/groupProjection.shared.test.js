import { describe, expect, it } from 'vitest';
import {
  applyGroupOverrides,
  deriveEffectiveGroupsForPlan,
  deriveDisplayGroupsForSelectedPlans,
  deriveDisplayGroupsForFeatures,
  getDisplayGroupOwnerPlanByFeatureId,
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

  it('keeps cross-plan members in a group owned by a selected mother plan', () => {
    const groupsByPlanId = {
      p1: [{ id: 'g-project', plan_id: 'p1', name: 'Project work', members: ['child'] }],
      p2: [{ id: 'g-team', plan_id: 'p2', name: 'Team work', members: [] }],
    };
    const features = [
      { id: 'parent', project: 'p1', parentId: null },
      { id: 'child', project: 'p2', parentId: 'parent' },
    ];

    const groups = deriveDisplayGroupsForSelectedPlans(
      ['p1'], groupsByPlanId, { groupOverrides: {}, scenarioGroups: [] }, features
    );

    expect(groups).toEqual([
      { id: 'g-project', plan_id: 'p1', name: 'Project work', members: ['child'] },
    ]);
  });

  it('gives a higher selected mother plan precedence for duplicate cross-plan members', () => {
    const groupsByPlanId = {
      p1: [{ id: 'g-project', plan_id: 'p1', name: 'Project work', members: ['child'] }],
      p2: [{ id: 'g-team', plan_id: 'p2', name: 'Team work', members: ['child'] }],
    };
    const features = [
      { id: 'parent', project: 'p1', parentId: null },
      { id: 'child', project: 'p2', parentId: 'parent' },
    ];

    const groups = deriveDisplayGroupsForSelectedPlans(
      ['p1', 'p2'], groupsByPlanId, { groupOverrides: {}, scenarioGroups: [] }, features
    );

    expect(groups.find((group) => group.id === 'g-project').members).toEqual(['child']);
    expect(groups.find((group) => group.id === 'g-team').members).toEqual([]);
  });

  it('keeps the higher mother-plan owner when selected plans are ordered low to high', () => {
    const groupsByPlanId = {
      p1: [{ id: 'g-project', plan_id: 'p1', name: 'Project work', members: ['child'] }],
      p2: [{ id: 'g-team', plan_id: 'p2', name: 'Team work', members: ['child'] }],
    };
    const features = [
      { id: 'parent', project: 'p1', parentId: null },
      { id: 'child', project: 'p2', parentId: 'parent' },
    ];
    const groups = deriveDisplayGroupsForSelectedPlans(
      ['p2', 'p1'], groupsByPlanId, { groupOverrides: {}, scenarioGroups: [] }, features
    );

    expect(getDisplayGroupOwnerPlanByFeatureId(groups).get('child')).toBe('p1');
  });

  it('retains an explicitly grouped task from an unrelated plan', () => {
    const groupsByPlanId = {
      p1: [{ id: 'g-project', plan_id: 'p1', name: 'Project work', members: ['other'] }],
    };
    const features = [{ id: 'other', project: 'p3', parentId: null }];

    const groups = deriveDisplayGroupsForSelectedPlans(
      ['p1'], groupsByPlanId, { groupOverrides: {}, scenarioGroups: [] }, features
    );

    expect(groups[0].members).toEqual(['other']);
  });

  it('projects a mother-plan group into the lane containing its visible cross-plan member', () => {
    const groups = [
      { id: 'parent', plan_id: 'p1', name: 'Parent', members: [], parent_id: null },
      { id: 'child', plan_id: 'p1', name: 'Child', members: ['other'], parent_id: 'parent' },
    ];

    expect(deriveDisplayGroupsForFeatures(groups, [{ id: 'other' }]).map((group) => group.id))
      .toEqual(['parent', 'child']);
  });

  it('does not project a higher-plan group into a descendant lane without its member', () => {
    const groups = [
      { id: 'higher', plan_id: 'p1', name: 'Higher', members: ['child'], parent_id: null },
      { id: 'lower', plan_id: 'p2', name: 'Lower', members: [], parent_id: null },
    ];

    expect(deriveDisplayGroupsForFeatures(groups, [], 'p2').map((group) => group.id))
      .toEqual(['lower']);
  });

  it('derives pending create/update/delete group changes', () => {
    const scenario = {
      scenarioGroups: [{ id: 'tmp_1', plan_id: 'p1' }],
      groupOverrides: {
        g1: { name: 'Renamed', memberDeltas: [] },
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
