import { describe, expect, it } from 'vitest';
import { createViewSelectors } from '../../www/js/application/selectors/viewSelectors.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';

describe('application/selectors/viewSelectors', () => {
  it('reads presentation options, Context, and saved-view state', () => {
    const state = createInitialAppState();
    state.view.options = {
      ...state.view.options,
      timelineScale: 'weeks',
      capacityViewMode: 'project',
      focusedPlanId: 'program-1',
      featureSortMode: 'projectThenRank',
      packedMode: true,
      displayMode: 'packed',
      hiddenTypes: ['Task'],
    };
    state.view.context = {
      parent: true,
      child: false,
      dependency: true,
      otherAllocations: false,
    };
    state.view.saved = [{ id: 'v1', name: 'Saved view' }];
    state.view.activeId = 'v1';
    const selectors = createViewSelectors({ getState: () => state });

    expect(selectors.getTimelineScale()).toBe('weeks');
    expect(selectors.getCapacityViewMode()).toBe('project');
    expect(selectors.getFocusedPlanId()).toBe('program-1');
    expect(selectors.getFeatureSortMode()).toBe('projectThenRank');
    expect(selectors.getPackedMode()).toBe(true);
    expect(selectors.getDisplayMode()).toBe('packed');
    expect(selectors.getHiddenTypes()).toEqual(new Set(['Task']));
    expect(selectors.getContext()).toEqual(state.view.context);
    expect(selectors.getSavedViews()).toEqual([{ id: 'v1', name: 'Saved view' }]);
    expect(selectors.getActiveViewId()).toBe('v1');
  });

  it('reads canonical defaults before any saved view is applied', () => {
    const selectors = createViewSelectors({ getState: () => createInitialAppState() });

    expect(selectors.getHiddenTypes()).toEqual(new Set());
    expect(selectors.isTypeVisible('epic')).toBe(true);
    expect(selectors.getTimelineScale()).toBe('months');
    expect(selectors.getShowUnplannedWork()).toBe(true);
    expect(selectors.getShowUnassignedCards()).toBe(true);
    expect(selectors.getDisplayMode()).toBe('normal');
    expect(selectors.getCapacityViewMode()).toBe('team');
    expect(selectors.getFocusedPlanId()).toBe('');
    expect(selectors.getFeatureSortMode()).toBe('rank');
    expect(selectors.getContext()).toEqual({
      parent: false,
      child: false,
      dependency: false,
      otherAllocations: false,
    });
  });

  it('offers graph levels from scoped task plans and resolves an unavailable preference', () => {
    const state = createInitialAppState();
    state.baseline.projects = [
      { id: 'team-f', type: 'team', container_order: 2 },
      { id: 'project-a', type: 'project', container_order: 1 },
      { id: 'program-1', type: 'program', container_order: 0 },
    ];
    state.baseline.teams = [{ id: 'team-f' }];
    state.baseline.features = [
      { id: 'program-task', project: 'program-1', parentId: null, state: 'Active',
        capacity: [], relations: [] },
      { id: 'project-task', project: 'project-a', parentId: 'program-task', state: 'Active',
        capacity: [], relations: [] },
      { id: 'team-task', project: 'team-f', parentId: 'project-task', state: 'Active',
        capacity: [{ team: 'team-f', capacity: 40 }], relations: [] },
    ];
    state.selection.projectIds = ['project-a'];
    const selectors = createViewSelectors({ getState: () => state });

    expect(selectors.getAvailableGraphTypes()).toEqual(['project']);
    state.view.context.parent = true;
    expect(selectors.getAvailableGraphTypes()).toEqual(['program', 'project']);
    state.view.context.child = true;
    expect(selectors.getAvailableGraphTypes()).toEqual(['program', 'project', 'team']);
    state.view.options.capacityViewMode = 'team';
    expect(selectors.getEffectiveCapacityViewMode()).toBe('team');
    state.view.context.child = false;
    expect(selectors.getEffectiveCapacityViewMode()).toBe('project');

    state.view.context.parent = false;
    state.selection.projectIds = ['team-f'];
    state.view.options.capacityViewMode = 'project';

    expect(selectors.getAvailableGraphTypes()).toEqual(['team']);
    expect(selectors.getEffectiveCapacityViewMode()).toBe('team');
    state.selection.projectIds = ['team-f', 'program-1'];
    expect(selectors.getAvailableGraphTypes()).toEqual(['program', 'team']);
    state.selection.projectIds = [];
    expect(selectors.getEffectiveCapacityViewMode()).toBeNull();
  });
});
