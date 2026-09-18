import { getAllTaskFiltersEnabled } from './shared/taskFilters.js';
import { createDefaultViewOptions } from './shared/viewDefaults.js';
import { loadLocalPluginData } from './shared/localScenarioPluginData.js';

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
        // Baseline has no server-side scenario record, so its pluginData bag
        // is restored from the local fallback store instead of the server.
        pluginData: loadLocalPluginData('baseline'),
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
