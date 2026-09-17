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
    expect(selectors.getFeatureSortMode()).toBe('rank');
    expect(selectors.getContext()).toEqual({
      parent: false,
      child: false,
      dependency: false,
      otherAllocations: false,
    });
  });
});
