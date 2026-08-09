import { describe, it, expect } from 'vitest';
import {
  createLegacyViewSelectors,
  createViewSelectors,
} from '../../www/js/application/selectors/viewSelectors.js';

describe('application/selectors/viewSelectors', () => {
  it('legacy branch reads timelineScale/showDependencies/condensedCards from view service', () => {
    const state = {
      _viewService: {
        timelineScale: 'quarters',
        showDependencies: true,
        condensedCards: true,
        capacityViewMode: 'project',
        highlightFeatureRelationMode: true,
        displayMode: 'compact',
      },
    };

    const selectors = createLegacyViewSelectors(state);
    expect(selectors.getTimelineScale()).toBe('quarters');
    expect(selectors.getShowDependencies()).toBe(true);
    expect(selectors.getCondensedCards()).toBe(true);
    expect(selectors.getCapacityViewMode()).toBe('project');
    expect(selectors.getHighlightFeatureRelationMode()).toBe(true);
    expect(selectors.getFeatureSortMode()).toBe('rank');
    expect(selectors.getPackedMode()).toBe(false);
    expect(selectors.getShowUnassignedCards()).toBe(false);
    expect(selectors.getDisplayMode()).toBe('compact');
  });

  it('legacy branch falls back safely when view service is unavailable', () => {
    const state = {
      timelineScale: 'years',
      showDependencies: false,
    };

    const selectors = createLegacyViewSelectors(state);
    expect(selectors.getTimelineScale()).toBe('years');
    expect(selectors.getShowDependencies()).toBe(false);
    expect(selectors.getCondensedCards()).toBe(false);
    expect(selectors.getFeatureSortMode()).toBe('rank');
    expect(selectors.getPackedMode()).toBe(false);
    expect(selectors.getShowUnassignedCards()).toBe(false);
    expect(selectors.getDisplayMode()).toBe('normal');
  });

  it('store branch reads timelineScale/showDependencies/condensedCards from view options', () => {
    const store = {
      getState: () => ({
        view: {
          options: {
            timelineScale: 'weeks',
            showDependencies: true,
            condensedCards: false,
            capacityViewMode: 'project',
            highlightFeatureRelationMode: true,
            featureSortMode: 'projectThenRank',
            packedMode: true,
            showUnassignedCards: true,
            displayMode: 'packed',
          },
        },
      }),
    };

    const selectors = createViewSelectors(store);
    expect(selectors.getTimelineScale()).toBe('weeks');
    expect(selectors.getShowDependencies()).toBe(true);
    expect(selectors.getCondensedCards()).toBe(false);
    expect(selectors.getCapacityViewMode()).toBe('project');
    expect(selectors.getHighlightFeatureRelationMode()).toBe(true);
    expect(selectors.getFeatureSortMode()).toBe('projectThenRank');
    expect(selectors.getPackedMode()).toBe(true);
    expect(selectors.getShowUnassignedCards()).toBe(true);
    expect(selectors.getDisplayMode()).toBe('packed');
  });

  it('store branch applies defaults when options are missing', () => {
    const store = {
      getState: () => ({
        view: {
          options: {},
        },
      }),
    };

    const selectors = createViewSelectors(store);
    expect(selectors.getTimelineScale()).toBe('months');
    expect(selectors.getShowDependencies()).toBe(false);
    expect(selectors.getCondensedCards()).toBe(false);
    expect(selectors.getFeatureSortMode()).toBe('rank');
    expect(selectors.getPackedMode()).toBe(false);
    expect(selectors.getShowUnassignedCards()).toBe(false);
    expect(selectors.getDisplayMode()).toBe('normal');
  });

  it('store branch falls back to legacy saved/active view when store slice is empty', () => {
    const store = {
      getState: () => ({
        view: {
          saved: [],
          activeId: null,
          options: {},
        },
      }),
    };
    const legacyState = {
      savedViews: [{ id: 'legacy-v1', name: 'Legacy View' }],
      activeViewId: 'legacy-v1',
    };

    const selectors = createViewSelectors(store, legacyState);
    expect(selectors.getSavedViews()).toEqual([{ id: 'legacy-v1', name: 'Legacy View' }]);
    expect(selectors.getActiveViewId()).toBe('legacy-v1');
  });
});
