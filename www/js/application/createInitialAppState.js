/**
 * Factory for the canonical client-state shape.
 *
 * This is intentionally data-only. Lookup maps, effective features, task type
 * metadata, visibility, and capacity inputs will be derived by selectors as
 * legacy State responsibilities move into the application layer.
 */
export function createInitialAppState() {
  return {
    lifecycle: {
      status: 'idle',
      error: null,
    },
    baseline: {
      revision: 0,
      projects: [],
      teams: [],
      features: [],
      iterationsByProject: {},
    },
    scenarios: {
      activeId: null,
      items: [],
    },
    selection: {
      projectIds: [],
      teamIds: [],
      featureStateNames: [],
      taskFilters: {},
      taskTypeNames: [],
      sidebarDisabled: {},
    },
    view: {
      activeId: null,
      saved: [],
      options: {},
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
  };
}
