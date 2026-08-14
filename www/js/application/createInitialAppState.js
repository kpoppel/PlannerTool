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
      activeId: 'baseline',
      items: [{ id: 'baseline', name: 'Baseline', overrides: {} }],
    },
    selection: {
      projectIds: [],
      teamIds: [],
      featureStateNames: [],
      taskFilters: {
        schedule: { planned: true, unplanned: true },
        allocation: { allocated: true, unallocated: true },
        hierarchy: { hasParent: true, noParent: true },
        relations: { hasLinks: true, noLinks: true },
      },
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
