import { expect } from '@esm-bundle/chai';

import {
  buildChildrenMap,
  buildFeatureVisibilityContext,
  featurePassesFilters,
  getVisibleFeatures,
} from '../../www/js/services/FeatureVisibilityService.js';

function createNamespacedState({
  projects = [],
  teams = [],
  expandedIds = [],
  selectedStates = ['New'],
  showUnplannedWork = true,
  showUnallocatedCards = true,
} = {}) {
  return {
    selection: {
      getProjects: () => projects,
      getTeams: () => teams,
      getExpansionState: () => ({
        expandParentChild: false,
        expandRelations: false,
        expandTeamAllocated: true,
      }),
      getExpandedFeatureIds: () => new Set(expandedIds),
    },
    filters: {
      getFeatureStates: () => selectedStates,
    },
    view: {
      getShowOnlyProjectHierarchy: () => false,
      getShowUnplannedWork: () => showUnplannedWork,
      getShowUnallocatedCards: () => showUnallocatedCards,
      getHiddenTypes: () => [],
    },
    taskTypes: {
      isVisible: () => true,
    },
  };
}

describe('FeatureVisibilityService', () => {
  it('supports namespaced planner api expansion state for team-only board visibility', () => {
    const features = [
      {
        id: 'e1',
        project: 'p2',
        type: 'epic',
        state: 'New',
        capacity: [],
      },
      {
        id: 'f1',
        project: 'p2',
        type: 'feature',
        state: 'New',
        parentId: 'e1',
        capacity: [{ team: 't1', capacity: 1 }],
      },
    ];
    const state = createNamespacedState({
      projects: [],
      teams: [{ id: 't1', selected: true }],
      expandedIds: ['e1', 'f1'],
    });
    const context = buildFeatureVisibilityContext({
      state,
      allFeatures: features,
      childrenMap: buildChildrenMap(features),
    });

    expect(context.hasExpansion).to.equal(true);
    expect(featurePassesFilters(features[0], context)).to.equal(true);
    expect(getVisibleFeatures(features, context).map((feature) => feature.id)).to.deep.equal([
      'e1',
      'f1',
    ]);
  });
});