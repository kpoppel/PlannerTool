import { describe, it, expect } from 'vitest';
import { createViewSelectors } from '../../www/js/application/selectors/viewSelectors.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';

describe('application/selectors/viewSelectors', () => {
  it('store branch reads timelineScale/showDependencies/condensedCards from view options', () => {
    const store = {
      getState: () => ({
        baseline: {
          features: [],
        },
        selection: {
          projectIds: [],
          teamIds: [],
        },
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
            hiddenTypes: ['Task'],
            showUnplannedWork: true,
            showOnlyProjectHierarchy: true,
          },
          expansion: {
            parentChild: true,
            relations: true,
            teamAllocated: true,
          },
          saved: [{ id: 'v1', name: 'Saved view' }],
          activeId: 'v1',
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
    expect(selectors.getHiddenTypes()).toEqual(new Set(['Task']));
    expect(selectors.getExpandedFeatureIds()).toEqual(new Set());
    expect(selectors.getSavedViews()).toEqual([{ id: 'v1', name: 'Saved view' }]);
    expect(selectors.getActiveViewId()).toBe('v1');
  });

  it('store branch reads canonical defaults from a fully shaped view slice', () => {
    const store = {
      getState: () => ({
        baseline: {
          features: [
            { id: 'f-project', project: 'p1', capacity: [] },
            { id: 'f-team', project: 'p2', capacity: [{ team: 't1', capacity: 1 }] },
            { id: 'f-hidden', project: 'p3', capacity: [] },
          ],
        },
        selection: {
          projectIds: ['p1'],
          teamIds: ['t1'],
        },
        view: {
          options: {
            timelineScale: 'months',
            showDependencies: false,
            condensedCards: false,
            capacityViewMode: 'team',
            highlightFeatureRelationMode: false,
            featureSortMode: 'rank',
            packedMode: false,
            showUnassignedCards: false,
            displayMode: 'normal',
            hiddenTypes: [],
            showUnplannedWork: false,
            showOnlyProjectHierarchy: false,
          },
          expansion: {
            parentChild: false,
            relations: false,
            teamAllocated: false,
          },
          saved: [],
          activeId: null,
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
    expect(selectors.getSavedViews()).toEqual([]);
    expect(selectors.getActiveViewId()).toBe(null);
  });

  it('store branch computes expanded feature ids from store expansion state only', () => {
    const store = {
      getState: () => ({
        baseline: {
          features: [
            { id: 'f-project', project: 'p1', capacity: [] },
            { id: 'f-team', project: 'p2', capacity: [{ team: 't1', capacity: 1 }] },
            { id: 'f-hidden', project: 'p3', capacity: [] },
          ],
        },
        selection: {
          projectIds: ['p1'],
          teamIds: ['t1'],
        },
        view: {
          expansion: {
            parentChild: false,
            relations: false,
            teamAllocated: false,
          },
          options: {
            hiddenTypes: [],
            timelineScale: 'months',
            showDependencies: false,
            condensedCards: false,
            capacityViewMode: 'team',
            highlightFeatureRelationMode: false,
            featureSortMode: 'rank',
            packedMode: false,
            showUnassignedCards: false,
            displayMode: 'normal',
            showUnplannedWork: false,
            showOnlyProjectHierarchy: false,
          },
          saved: [],
          activeId: null,
        },
      }),
    };

    const selectors = createViewSelectors(store);
    expect(Array.from(selectors.getExpandedFeatureIds())).toEqual(['f-project']);
  });

  it('includes parent and child closure when parent/child expansion is enabled', () => {
    const store = {
      getState: () => ({
        baseline: {
          features: [
            { id: 'epic-1', project: 'p2', parentId: null, capacity: [] },
            { id: 'story-1', project: 'p1', parentId: 'epic-1', capacity: [] },
            { id: 'story-2', project: 'p1', parentId: 'epic-1', capacity: [] },
          ],
        },
        selection: {
          projectIds: ['p1'],
          teamIds: [],
        },
        view: {
          expansion: {
            parentChild: true,
            relations: false,
            teamAllocated: false,
          },
          options: {
            hiddenTypes: [],
            timelineScale: 'months',
            showDependencies: false,
            condensedCards: false,
            capacityViewMode: 'team',
            highlightFeatureRelationMode: false,
            featureSortMode: 'rank',
            packedMode: false,
            showUnassignedCards: false,
            displayMode: 'normal',
            showUnplannedWork: false,
            showOnlyProjectHierarchy: false,
          },
          saved: [],
          activeId: null,
        },
      }),
    };

    const selectors = createViewSelectors(store);
    expect(Array.from(selectors.getExpandedFeatureIds()).sort()).toEqual(
      ['epic-1', 'story-1', 'story-2'].sort()
    );
  });

  it('memoizes the expanded feature set while the store state is unchanged', () => {
    const state = {
      baseline: {
        features: [
          { id: 'epic-1', project: 'p2', parentId: null, capacity: [] },
          { id: 'story-1', project: 'p1', parentId: 'epic-1', capacity: [] },
          { id: 'story-2', project: 'p1', parentId: 'epic-1', capacity: [] },
        ],
      },
      selection: {
        projectIds: ['p1'],
        teamIds: [],
      },
      view: {
        expansion: {
          parentChild: true,
          relations: false,
          teamAllocated: false,
        },
        options: {
          hiddenTypes: [],
          timelineScale: 'months',
          showDependencies: false,
          condensedCards: false,
          capacityViewMode: 'team',
          highlightFeatureRelationMode: false,
          featureSortMode: 'rank',
          packedMode: false,
          showUnassignedCards: false,
          displayMode: 'normal',
          showUnplannedWork: false,
          showOnlyProjectHierarchy: false,
        },
        saved: [],
        activeId: null,
      },
    };

    const store = { getState: () => state };
    const selectors = createViewSelectors(store);

    const first = selectors.getExpandedFeatureSet();
    const second = selectors.getExpandedFeatureSet();

    expect(second).toBe(first);
    expect(second.expandedIds).toBe(first.expandedIds);
    expect(second.counts).toBe(first.counts);
  });

  it('counts only genuinely new ids added by a relation expansion', () => {
    const store = {
      getState: () => ({
        baseline: {
          features: [
            { id: 'root', project: 'p1', parentId: null, relations: [{ id: 'related' }], capacity: [] },
            { id: 'already-visible', project: 'p1', parentId: null, relations: [], capacity: [] },
            { id: 'related', project: 'p2', parentId: null, relations: [], capacity: [] },
          ],
        },
        selection: {
          projectIds: ['p1'],
          teamIds: [],
        },
        view: {
          expansion: {
            parentChild: false,
            relations: true,
            teamAllocated: false,
          },
          options: {
            hiddenTypes: [],
            timelineScale: 'months',
            showDependencies: false,
            condensedCards: false,
            capacityViewMode: 'team',
            highlightFeatureRelationMode: false,
            featureSortMode: 'rank',
            packedMode: false,
            showUnassignedCards: false,
            displayMode: 'normal',
            showUnplannedWork: false,
            showOnlyProjectHierarchy: false,
          },
          saved: [],
          activeId: null,
        },
      }),
    };

    const selectors = createViewSelectors(store);
    const result = selectors.getExpandedFeatureSet();

    expect(result.counts.relations).toBe(1);
    expect(Array.from(result.expandedIds).sort()).toEqual(['already-visible', 'related', 'root'].sort());
  });

  it('counts team-allocation additions against the base selected set rather than against itself', () => {
    const store = {
      getState: () => ({
        baseline: {
          features: [
            { id: 'a', project: 'p1', parentId: null, capacity: [{ team: 't1', capacity: 5 }] },
            { id: 'b', project: 'p1', parentId: null, capacity: [{ team: 't1', capacity: 5 }] },
            { id: 'c', project: 'p2', parentId: null, capacity: [{ team: 't1', capacity: 5 }] },
            { id: 'd', project: 'p3', parentId: null, capacity: [{ team: 't2', capacity: 5 }] },
          ],
        },
        selection: {
          projectIds: ['p1'],
          teamIds: ['t1'],
        },
        view: {
          expansion: {
            parentChild: false,
            relations: false,
            teamAllocated: true,
          },
          options: {
            hiddenTypes: [],
            timelineScale: 'months',
            showDependencies: false,
            condensedCards: false,
            capacityViewMode: 'team',
            highlightFeatureRelationMode: false,
            featureSortMode: 'rank',
            packedMode: false,
            showUnassignedCards: false,
            displayMode: 'normal',
            showUnplannedWork: false,
            showOnlyProjectHierarchy: false,
          },
          saved: [],
          activeId: null,
        },
      }),
    };

    const selectors = createViewSelectors(store);
    const result = selectors.getExpandedFeatureSet();

    expect(result.counts.teamAllocated).toBe(1);
    expect(Array.from(result.expandedIds).sort()).toEqual(['a', 'b', 'c'].sort());
  });

  it('counts only non-parent-child relation links in dependency expansion', () => {
    const store = {
      getState: () => ({
        baseline: {
          features: [
            { id: 'root', project: 'p1', parentId: null, relations: [
              { id: 'child', type: 'Child' },
              { id: 'depends-on', type: 'DependsOn' },
              { id: 'depends-on-2', type: 'DependsOn' },
            ], capacity: [] },
            { id: 'child', project: 'p2', parentId: null, relations: [], capacity: [] },
            { id: 'depends-on', project: 'p2', parentId: null, relations: [], capacity: [] },
            { id: 'depends-on-2', project: 'p3', parentId: null, relations: [], capacity: [] },
          ],
        },
        selection: {
          projectIds: ['p1'],
          teamIds: [],
        },
        view: {
          expansion: {
            parentChild: false,
            relations: true,
            teamAllocated: false,
          },
          options: {
            hiddenTypes: [],
            timelineScale: 'months',
            showDependencies: false,
            condensedCards: false,
            capacityViewMode: 'team',
            highlightFeatureRelationMode: false,
            featureSortMode: 'rank',
            packedMode: false,
            showUnassignedCards: false,
            displayMode: 'normal',
            showUnplannedWork: false,
            showOnlyProjectHierarchy: false,
          },
          saved: [],
          activeId: null,
        },
      }),
    };

    const selectors = createViewSelectors(store);
    const result = selectors.getExpandedFeatureSet();

    expect(result.counts.relations).toBe(2);
    expect(Array.from(result.expandedIds).sort()).toEqual(
      ['depends-on', 'depends-on-2', 'root'].sort()
    );
  });

  it('reads view options from the initial app state before any view is applied', () => {
    const store = { getState: () => createInitialAppState() };
    const selectors = createViewSelectors(store);

    expect(selectors.getHiddenTypes()).toEqual(new Set());
    expect(selectors.isTypeVisible('epic')).toBe(true);
    expect(selectors.getTimelineScale()).toBe('months');
    expect(selectors.getShowUnplannedWork()).toBe(true);
    expect(selectors.getShowUnassignedCards()).toBe(true);
    expect(selectors.getDisplayMode()).toBe('normal');
    expect(selectors.getCapacityViewMode()).toBe('team');
    expect(selectors.getFeatureSortMode()).toBe('rank');
  });
});
