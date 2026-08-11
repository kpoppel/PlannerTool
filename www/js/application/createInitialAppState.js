export function createInitialAppState() {
  return {
    lifecycle: {
      status: 'idle',
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
      activeId: null,
      items: [],
    },
    selection: {
      projectIds: null,
      teamIds: null,
      featureStateNames: [],
      taskFilters: {
        schedule: null,
        allocation: null,
        hierarchy: null,
        relations: null,
      },
      taskTypeNames: [],
      sidebarDisabled: {},
    },
    view: {
      activeId: null,
      saved: [],
      options: {
        debugFlag: false,
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
  };
}
