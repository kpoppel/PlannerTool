/**
 * Versioned public application API for plugins and UI controllers.
 *
 * The first version delegates to the legacy State facade during migration. New
 * integrations must use this API rather than importing State or internal
 * services, allowing the facade to be removed once first-party consumers move.
 */
export const PLANNER_API_VERSION = 1;

export function createPlannerApi(state) {
  if (!state) throw new TypeError('PlannerApi requires an application state adapter');

  return Object.freeze({
    version: PLANNER_API_VERSION,
    features: Object.freeze({
      list: () => state.getEffectiveFeatures(),
      getById: (id) => state.getEffectiveFeatureById(id),
      updateDates: (updates) => state.updateFeatureDates(updates),
      updateField: (id, field, value) => state.updateFeatureField(id, field, value),
      updateRelations: (id, relations) => state.updateFeatureRelations(id, relations),
      revert: (id) => state.revertFeature(id),
      passesTaskFilters: (feature) => state.taskFilterService.featurePassesFilters(feature),
    }),
    selection: Object.freeze({
      getProjects: () => state.projects,
      getTeams: () => state.teams,
      selectProject: (id, selected) => state.setProjectSelected(id, selected),
      selectTeam: (id, selected) => state.setTeamSelected(id, selected),
      setProjects: (selections) => state.setProjectsSelectedBulk(selections),
      setTeams: (selections) => state.setTeamsSelectedBulk(selections),
      getExpandedFeatureIds: () => state.getExpandedFeatureIds(),
      getChildrenByParent: () => state.childrenByParent,
      getExpansionState: () => state.expansionState,
    }),
    filters: Object.freeze({
      getFeatureStates: () => Array.from(state.selectedFeatureStateFilter || []),
      getAvailableFeatureStates: () => state.availableFeatureStates,
      compareFeatureStates: (left, right) => state.compareFeatureStates(left, right),
      getTaskFilters: () => state.taskFilterService.getFilters(),
      setTaskFilter: (dimension, option, selected) =>
        state.taskFilterService.setFilter(dimension, option, selected),
      setAllFeatureStatesSelected: (selected) => state.setAllStatesSelected(selected),
      setTaskTypes: (types) => state.setSelectedTaskTypes(types),
    }),
    taskTypes: Object.freeze({
      getAvailable: () => state.availableTaskTypes,
      isVisible: (type) => state.isTypeVisible(type),
      getHierarchy: () => state.taskTypeHierarchy,
      getLevel: (type) => state.getTypeLevel(type),
      getDisplayName: (type) => state.getTypeDisplayName(type),
      compareFeatureStates: (left, right) => state.compareFeatureStates(left, right),
    }),
    view: Object.freeze({
      getCapacityMode: () => state.capacityViewMode,
      getHiddenTypes: () => Array.from(state.hiddenTypes || []),
      setExpansion: (options) => state.setExpansionState(options),
      setShowDependencies: (visible) => state.setShowDependencies(visible),
      getShowDependencies: () => state.showDependencies,
      getCondensedCards: () => state.condensedCards,
    }),
    scenarios: Object.freeze({
      list: () => state.scenarios.list(),
      getActive: () => state.getActiveScenario(),
      getActiveId: () => state.activeScenarioId,
      activate: (id) => state.activateScenario(id),
      save: (id) => state.saveScenario(id),
    }),
    views: Object.freeze({
      list: () => state.views.list(),
      getActiveId: () => state.views.getActiveId(),
      load: (id) => state.views.load(id),
    }),
    capacity: Object.freeze({
      get: () => ({
        dates: state.capacityDates,
        teamDailyCapacity: state.teamDailyCapacity,
        teamDailyCapacityMap: state.teamDailyCapacityMap,
        projectDailyCapacity: state.projectDailyCapacity,
        projectDailyCapacityMap: state.projectDailyCapacityMap,
        totalOrgDailyPerTeamAvg: state.totalOrgDailyPerTeamAvg,
      }),
    }),
    plugins: Object.freeze({
      getState: (id) => state.pluginStateService.get(id),
      setState: (id, value, options) => state.pluginStateService.set(id, value, options),
      updateState: (id, value, options) => state.pluginStateService.update(id, value, options),
      subscribe: (id, listener) => state.pluginStateService.subscribe(id, listener),
      getConfig: () => state.plugins.getConfig(),
      getSchemas: () => state.plugins.getSchemas(),
    }),
    markers: Object.freeze({
      getAll: () => state.markers.getAll(),
    }),
    colors: Object.freeze({
      getProject: (projectId) => state.getProjectColor(projectId),
      getFeatureState: (stateName) => state.getFeatureStateColor(stateName),
      getFeatureStateColors: () => state.getFeatureStateColors(),
      getFeatureStateCategory: (stateName) =>
        state.featureStateService.getCategoryForState(stateName),
    }),
    sidebar: Object.freeze({
      setDisabled: (controls) => state.setSidebarDisabledElements(controls),
      clearDisabled: () => state.clearSidebarDisabledElements(),
    }),
    cost: Object.freeze({
      get: (overrides) => state.cost.get(overrides),
      getTeams: () => state.cost.getTeams(),
    }),
    events: Object.freeze({
      getAll: (planId) => state.events.getAll(planId),
      getCategories: () => state.events.getCategories(),
      create: (payload) => state.events.create(payload),
      update: (eventId, payload) => state.events.update(eventId, payload),
      delete: (eventId) => state.events.delete(eventId),
      createCategory: (payload) => state.events.createCategory(payload),
      updateCategory: (categoryId, payload) => state.events.updateCategory(categoryId, payload),
      deleteCategory: (categoryId) => state.events.deleteCategory(categoryId),
    }),
    history: Object.freeze({
      get: (projectId, options) => state.history.get(projectId, options),
    }),
  });
}
