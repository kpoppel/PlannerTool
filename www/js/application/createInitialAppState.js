import { getAllTaskFiltersEnabled } from './shared/taskFilters.js';
import { createDefaultViewOptions } from './shared/viewDefaults.js';

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
      options: createDefaultViewOptions(),
      expansion: {
        parentChild: false,
        relations: false,
        teamAllocated: false,
      },
      context: {
        parent: false,
        child: false,
        dependency: false,
        otherAllocations: false,
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
