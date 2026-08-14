import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';

describe('application/store', () => {
  beforeEach(() => {
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('starts with the canonical top-level slices', () => {
    const current = store.getState();

    expect(current).toHaveProperty('lifecycle');
    expect(current).toHaveProperty('baseline');
    expect(current).toHaveProperty('scenarios');
    expect(current).toHaveProperty('selection');
    expect(current).toHaveProperty('view');
    expect(current).toHaveProperty('groups');
    expect(current).toHaveProperty('pluginState');
    expect(current).toHaveProperty('capacity');
  });

  it('uses canonical empty-array selection state and stable view/scenario defaults', () => {
    const current = store.getState();

    expect(current.selection.projectIds).toEqual([]);
    expect(current.selection.teamIds).toEqual([]);
    expect(current.selection.featureStateNames).toEqual([]);
    expect(current.selection.taskTypeNames).toEqual([]);
    expect(current.scenarios.activeId).toBe('baseline');
    expect(current.scenarios.items).toEqual([{
      id: 'baseline',
      name: 'Baseline',
      readonly: true,
      overrides: {},
      groupOverrides: {},
      scenarioGroups: [],
    }]);
    expect(current.view.expansion).toEqual({
      parentChild: false,
      relations: false,
      teamAllocated: false,
    });
    expect(current.groups.byPlanId).toEqual({});
    expect(current.featureDisplay.selectedId).toBeNull();
  });

  it('notifies selector subscribers only when the selected slice changes', () => {
    const updates = [];
    const unsubscribe = store.subscribe(
      (state) => state.selection.projectIds,
      (next, prev) => {
        updates.push({ next, prev });
      },
      { equalityFn: Object.is }
    );

    store.setState(
      (state) => ({
        ...state,
        view: {
          ...state.view,
          options: {
            ...state.view.options,
            unrelatedToggle: true,
          },
        },
      }),
      false,
      'test.unrelatedViewChange'
    );

    store.setState(
      (state) => ({
        ...state,
        selection: {
          ...state.selection,
          projectIds: ['project-1'],
        },
      }),
      false,
      'test.selectionChange'
    );

    unsubscribe();

    expect(updates).toHaveLength(1);
    expect(updates[0].prev).toEqual([]);
    expect(updates[0].next).toEqual(['project-1']);
  });
});
