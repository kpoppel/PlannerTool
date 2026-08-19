import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createGroupSelectors } from '../../www/js/application/selectors/groupSelectors.js';
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
            g2: { _deleted: true, memberDeltas: [] },
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

  it('store selector merges baseline with scenario overrides and local groups', () => {
    const selectors = createGroupSelectors(store);
    const groups = selectors.getEffectiveGroups('p1');

    expect(groups.map((group) => group.id)).toEqual(['g1', 'tmp_1']);
    expect(groups.find((group) => group.id === 'g1').members).toEqual(['f1', 'f2']);
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

  it('store selectors ignore null scenario state when baseline is active', () => {
    store.setState(
      {
        ...seedStore(),
        scenarios: {
          activeId: 'baseline',
          items: [{ id: 'baseline', name: 'Baseline', overrides: {}, scenarioGroups: [], groupOverrides: {} }],
        },
      },
      true,
      'test.resetStore.baselineScenario'
    );

    const selectors = createGroupSelectors(store);

    expect(() => selectors.getEffectiveGroups('p1')).not.toThrow();
    expect(selectors.getEffectiveGroups('p1')).toEqual([
      expect.objectContaining({ id: 'g1' }),
      expect.objectContaining({ id: 'g2' }),
    ]);
    expect(selectors.getPendingGroupChanges()).toEqual([]);
    expect(selectors.getGroupById('g1')).toEqual(expect.objectContaining({ id: 'g1' }));
  });

  it('store selectors require hydrated plan groups for lookups', () => {
    const selectors = createGroupSelectors(store);

    expect(() => selectors.getEffectiveGroups('missing-plan')).toThrow();
    expect(selectors.getGroupById('missing-group')).toBeNull();
    expect(selectors.hasPlanLoaded('missing-plan')).toBe(false);
  });

  it('store selectors require explicit scenario group metadata', () => {
    store.setState(
      {
        ...seedStore(),
        scenarios: {
          activeId: 's1',
          items: [{
            id: 's1',
            name: 'Strict',
            scenarioGroups: [{ id: 'tmp_1', plan_id: 'p1', name: 'Draft', members: [] }],
            groupOverrides: {},
          }],
        },
      },
      true,
      'test.resetStore.missingGroupMetadata'
    );

    const selectors = createGroupSelectors(store);

    expect(() => selectors.getPendingGroupChanges()).not.toThrow();
    expect(selectors.getPendingGroupChanges()).toEqual([
      expect.objectContaining({ type: 'create', group: expect.objectContaining({ id: 'tmp_1' }) }),
    ]);
    expect(selectors.getEffectiveGroups('p1')).toEqual([
      expect.objectContaining({ id: 'g1' }),
      expect.objectContaining({ id: 'g2' }),
      expect.objectContaining({ id: 'tmp_1' }),
    ]);
  });
});