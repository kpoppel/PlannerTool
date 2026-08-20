import { getAllTaskFiltersEnabled } from './shared/taskFilters.js';

/** @typedef {import('./types.js').AppState} AppState */

/**
 * Build the canonical initial Zustand state for Planner.
 * @returns {AppState}
 */
export function createInitialAppState() {
  return {
    lifecycle: {
      status: 'bootstrapping',
      error: null,
    },
    baseline: {
      revision: null,
      projects: [],
      teams: [],
      features: [],
      iterationsByProject: {},
    },
    scenarios: {
      activeId: 'baseline',
      changedIds: [],
      items: [{
        id: 'baseline',
        name: 'Baseline',
        readonly: true,
        overrides: {},
        groupOverrides: {},
        scenarioGroups: [],
      }],
    },
    selection: {
      projectIds: [],
      teamIds: [],
      featureStateNames: [],
      taskFilters: getAllTaskFiltersEnabled(),
      taskTypeNames: [],
      sidebarDisabled: {},
    },
    view: {
      activeId: null,
      saved: [],
      options: {
        debugFlag: false,
        highlightFeatureRelationMode: true,
      },
      expansion: {
        parentChild: false,
        relations: false,
        teamAllocated: false,
      },
    },
    groups: {
      byPlanId: {},
    },
    pluginState: {},
    capacity: {
      dates: [],
      teamDaily: [],
      teamDailyMap: [],
      projectDailyRaw: [],
      projectDaily: [],
      projectDailyMap: [],
      organizationDaily: [],
      organizationDailyPerTeamAverage: [],
    },
    featureDisplay: {
      selectedId: null,
    },
  };
}
