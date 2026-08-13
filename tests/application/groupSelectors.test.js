import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyGroupSelectors,
  createGroupSelectors,
} from '../../www/js/application/selectors/groupSelectors.js';
import { store } from '../../www/js/application/store.js';

function seedStore() {
  return {
    ...createInitialAppState(),
    groups: {
      byPlanId: {
        p1: [
          { id: 'g1', plan_id: 'p1', name: 'Core', members: ['f1'] },
          { id: 'g2', plan_id: 'p1', name: 'Ops', members: [] },
        ],
      },
    },
    scenarios: {
      activeId: 's1',
      items: [
        {
          id: 's1',
          scenarioGroups: [{ id: 'tmp_1', plan_id: 'p1', name: 'Draft', members: ['f3'] }],
          groupOverrides: {
            g1: { memberDeltas: [{ taskId: 'f2', op: 'add' }] },
            g2: { _deleted: true },
          },
        },
      ],
    },
  };
}

describe('application/selectors/groupSelectors', () => {
  beforeEach(() => {
    store.setState(seedStore(), true, 'test.resetStore');
  });

  it('legacy selector computes effective groups from cache + active scenario', () => {
    const state = {
      getActiveScenario: vi.fn(() => ({
        id: 's1',
        groupOverrides: { g1: { memberDeltas: [{ taskId: 'f2', op: 'add' }] } },
        scenarioGroups: [{ id: 'tmp_1', plan_id: 'p1', name: 'Draft', members: ['f3'] }],
      })),
      getPendingGroupChanges: vi.fn(() => [{ type: 'create', group: { id: 'tmp_1' } }]),
    };
    const groupService = {
      getGroupsForPlan: vi.fn(() => [{ id: 'g1', plan_id: 'p1', name: 'Core', members: ['f1'] }]),
      getGroupById: vi.fn(() => ({ id: 'g9' })),
      hasPlanLoaded: vi.fn(() => true),
    };

    const selectors = createLegacyGroupSelectors(state, groupService);
    const groups = selectors.getEffectiveGroups('p1');
    expect(groups.map((group) => group.id)).toEqual(['g1', 'tmp_1']);
    expect(groups.find((group) => group.id === 'g1')?.members).toEqual(['f1', 'f2']);
    expect(selectors.getPendingGroupChanges()).toHaveLength(1);
    expect(selectors.getGroupById('g9')).toEqual({ id: 'g9' });
    expect(selectors.hasPlanLoaded('p1')).toBe(true);
  });

  it('store selector merges baseline with scenario overrides and local groups', () => {
    const selectors = createGroupSelectors(store);
    const groups = selectors.getEffectiveGroups('p1');

    expect(groups.map((group) => group.id)).toEqual(['g1', 'tmp_1']);
    expect(groups.find((group) => group.id === 'g1')?.members).toEqual(['f1', 'f2']);
  });

  it('store selector derives pending group changes from active scenario', () => {
    const selectors = createGroupSelectors(store);
    const pending = selectors.getPendingGroupChanges();

    expect(pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create', group: expect.objectContaining({ id: 'tmp_1' }) }),
        expect.objectContaining({ type: 'update', groupId: 'g1' }),
        expect.objectContaining({ type: 'delete', groupId: 'g2' }),
      ])
    );
  });

  it('store getGroupById returns override-aware baseline groups', () => {
    const selectors = createGroupSelectors(store);
    const group = selectors.getGroupById('g1');

    expect(group).toBeTruthy();
    expect(group.name).toBe('Core');
    expect(group.members).toEqual(['f1', 'f2']);
  });

  it('store getGroupById hides baseline groups deleted in active scenario', () => {
    const selectors = createGroupSelectors(store);
    expect(selectors.getGroupById('g2')).toBeNull();
  });
});