/**
 * Versioned public application API for plugins and UI controllers.
 *
 * The first version delegates to the legacy State facade during migration. New
 * integrations must use this API rather than importing State or internal
 * services, allowing the facade to be removed once first-party consumers move.
 */
export const PLANNER_API_VERSION = 1;

const PLANNER_API_OVERRIDES = new Map();

export function setPlannerApiOverride(name, handler) {
  if (!name) return;
  if (typeof handler === 'function') {
    PLANNER_API_OVERRIDES.set(name, handler);
  } else {
    PLANNER_API_OVERRIDES.delete(name);
  }
}

export function clearPlannerApiOverride(name) {
  if (!name) return;
  PLANNER_API_OVERRIDES.delete(name);
}

function callPlannerApi(name, fallback, ...args) {
  if (PLANNER_API_OVERRIDES.has(name)) {
    return PLANNER_API_OVERRIDES.get(name)(...args);
  }
  return fallback(...args);
}

function buildDefaultScenarioCloneName(scenarios = [], date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const maxN = Math.max(
    0,
    ...scenarios
      .map((scenario) => /^\d{2}-\d{2} Scenario (\d+)$/i.exec(scenario.name)?.[1])
      .filter(Boolean)
      .map((value) => parseInt(value, 10))
  );

  return `${mm}-${dd} Scenario ${maxN + 1}`;
}

export function createPlannerApi(state) {
  if (!state) throw new TypeError('PlannerApi requires an application state adapter');

  const api = {
    version: PLANNER_API_VERSION,
    features: Object.freeze({
      list: () => state.getEffectiveFeatures(),
      getById: (id) => state.getEffectiveFeatureById(id),
      getTitle: (id) => state.getFeatureTitleById(id),
      getBaselineById: (id) => state.baselineFeatureById?.get?.(id),
      getBaseline: () => state.baselineFeatures,
      getChildrenByParent: () => state.childrenByParent,
      updateDates: (updates) => callPlannerApi('updateFeatureDates', state.updateFeatureDates.bind(state), updates),
      updateField: (id, field, value) =>
        callPlannerApi('updateFeatureField', state.updateFeatureField.bind(state), id, field, value),
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
      toggleTaskFilter: (dimension, option) => state.taskFilterService.toggleFilter(dimension, option),
      setAllFeatureStatesSelected: (selected) => state.setAllStatesSelected(selected),
      toggleFeatureState: (stateName) => state.toggleStateSelected(stateName),
      setTaskTypes: (types) => state.setSelectedTaskTypes(types),
    }),
    taskTypes: Object.freeze({
      getAvailable: () => state.availableTaskTypes,
      getOrdered: () => state.availableTaskTypesOrdered,
      isVisible: (type) => state.isTypeVisible(type),
      setVisible: (type, visible, suppressEmit) =>
        state.setTypeVisibility(type, visible, suppressEmit),
      getHierarchy: () => state.taskTypeHierarchy,
      getLevel: (type) => state.getTypeLevel(type),
      getDisplayName: (type) => state.getTypeDisplayName(type),
      compareFeatureStates: (left, right) => state.compareFeatureStates(left, right),
    }),
    view: Object.freeze({
      getCapacityMode: () => state.capacityViewMode,
      getTimelineScale: () => state.timelineScale,
      setTimelineScale: (scale) => state.setTimelineScale(scale),
      getDisplayMode: () => state.displayMode,
      setDisplayMode: (mode, suppressEmit) => state.setDisplayMode(mode, suppressEmit),
      getPackedMode: () => state.packedMode,
      getFeatureSortMode: () => state.featureSortMode,
      setFeatureSortMode: (mode) => state.setFeatureSortMode(mode),
      getHighlightFeatureRelationMode: () => state.highlightFeatureRelationMode,
      setCapacityMode: (mode) => state.setCapacityViewMode(mode),
      getHiddenTypes: () => Array.from(state.hiddenTypes || []),
      setExpansion: (options) => state.setExpansionState(options),
      setShowDependencies: (visible) => state.setShowDependencies(visible),
      getShowDependencies: () => state.showDependencies,
      getCondensedCards: () => state.condensedCards,
      setCondensedCards: (condensed) => state.setCondensedCards(condensed),
      captureCurrent: () => state.captureCurrentView(),
    }),
    scenarios: Object.freeze({
      list: () => state.scenarios.list(),
      getActive: () => state.getActiveScenario(),
      getActiveId: () => state.activeScenarioId,
      getDefaultCloneName: (date = new Date()) =>
        buildDefaultScenarioCloneName(state.scenarios.list() || [], date),
      hasUnsavedChanges: (scenario) => state.isScenarioUnsaved(scenario),
      activate: (id) => state.activateScenario(id),
      clone: (sourceId, name) => state.cloneScenario(sourceId, name),
      rename: (id, name) => state.renameScenario(id, name),
      delete: (id) => state.deleteScenario(id),
      save: (id) => state.saveScenario(id),
      refreshBaseline: () => state.refreshBaseline(),
      invalidateAndRefreshBaseline: () => state.invalidateAndRefreshBaseline(),
    }),
    views: Object.freeze({
      list: () => state.views.list(),
      save: (name, viewId = null) => state.views.save(name, viewId),
      rename: (viewId, newName) => state.views.rename(viewId, newName),
      delete: (viewId) => state.views.delete(viewId),
      restoreLast: () => state.views.restoreLast(),
      getActiveId: () => state.views.getActiveId(),
      getActiveData: () => state.views.getActiveData(),
      load: (id) => state.views.load(id),
    }),
    groups: Object.freeze({
      create: (payload) => state.groups.create(payload),
      update: (groupId, fields) => state.groups.update(groupId, fields),
      delete: (groupId) => state.groups.delete(groupId),
      getPendingChanges: () => state.groups.getPendingChanges(),
      clearPendingChanges: () => state.groups.clearPendingChanges(),
      confirmCreate: (tempId, realId) => state.groups.confirmCreate(tempId, realId),
      createInScenario: (planId, name, color = null, parentId = null) =>
        state.groups.createInScenario(planId, name, color, parentId),
      updateInScenario: (groupId, fields) => state.groups.updateInScenario(groupId, fields),
      deleteInScenario: (groupId) => state.groups.deleteInScenario(groupId),
      applyMemberDelta: (groupId, taskId, op) => state.groups.applyMemberDelta(groupId, taskId, op),
      publishBaseline: (features) => state.groups.publishBaseline(features),
    }),
    capacity: Object.freeze({
      get: () => ({
        dates: state.capacityDates,
        teamDailyCapacity: state.teamDailyCapacity,
        teamDailyCapacityMap: state.teamDailyCapacityMap,
        projectDailyCapacityRaw: state.projectDailyCapacityRaw,
        projectDailyCapacity: state.projectDailyCapacity,
        projectDailyCapacityMap: state.projectDailyCapacityMap,
        totalOrgDailyCapacity: state.totalOrgDailyCapacity,
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
      getTeam: (teamId) => state.getTeamColor?.(teamId),
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
      updateWorkItemCapacity: (workItemId, capacity) =>
        state.cost.updateWorkItemCapacity(workItemId, capacity),
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
    config: Object.freeze({
      getPref: (key) => state.config.getPref(key),
      setPref: (key, value) => state.config.setPref(key, value),
      saveAccountConfig: (account) => state.config.saveAccountConfig(account),
      updateProjectColor: (id, color) => state.config.updateProjectColor(id, color),
      updateTeamColor: (id, color) => state.config.updateTeamColor(id, color),
    }),
    server: Object.freeze({
      health: () => state.server.health(),
    }),
    featureService: Object.freeze({
      getEffectiveFeatures: () => state.getEffectiveFeatures(),
      computeExpandedFeatureSet: (selectedFeatureIds, options) =>
        state.featureService.computeExpandedFeatureSet(selectedFeatureIds, options),
      allCountsForProject: (projectId) => state.allCountsForProject(projectId),
      allCountsForTeam: (teamId) => state.allCountsForTeam(teamId),
    }),
    taskFilterService: Object.freeze({
      getFilters: () => state.taskFilterService.getFilters(),
      setFilter: (dimension, option, selected) =>
        state.taskFilterService.setFilter(dimension, option, selected),
      toggleFilter: (dimension, option) => state.taskFilterService.toggleFilter(dimension, option),
      featurePassesFilters: (feature) => state.taskFilterService.featurePassesFilters(feature),
    }),
    featureStateService: Object.freeze({
      isStateInCategory: (stateName, category) =>
        state.featureStateService.isStateInCategory(stateName, category),
      getCategoryForState: (stateName) => state.featureStateService.getCategoryForState(stateName),
    }),
    get projects() {
      return state.projects;
    },
    get teams() {
      return state.teams;
    },
    get baselineFeatures() {
      return state.baselineFeatures;
    },
    get baselineFeatureById() {
      return state.baselineFeatureById;
    },
    get childrenByParent() {
      return state.childrenByParent;
    },
    get availableFeatureStates() {
      return state.availableFeatureStates;
    },
    get selectedFeatureStateFilter() {
      return state.selectedFeatureStateFilter;
    },
    get availableTaskTypesOrdered() {
      return state.availableTaskTypesOrdered;
    },
    get taskTypeHierarchy() {
      return state.taskTypeHierarchy;
    },
    get activeScenarioId() {
      return state.activeScenarioId;
    },
    get savedViews() {
      return state.savedViews;
    },
    get activeViewId() {
      return state.activeViewId;
    },
    get timelineScale() {
      return state.timelineScale;
    },
    get displayMode() {
      return state.displayMode;
    },
    get packedMode() {
      return state.packedMode;
    },
    get condensedCards() {
      return state.condensedCards;
    },
    get showDependencies() {
      return state.showDependencies;
    },
    get showUnplannedWork() {
      return state.showUnplannedWork;
    },
    get showUnallocatedCards() {
      return state.showUnallocatedCards;
    },
    get showOnlyProjectHierarchy() {
      return state.showOnlyProjectHierarchy;
    },
    get capacityViewMode() {
      return state.capacityViewMode;
    },
    get featureSortMode() {
      return state.featureSortMode;
    },
    get highlightFeatureRelationMode() {
      return state.highlightFeatureRelationMode;
    },
    get expansionState() {
      return state.expansionState;
    },
    get projectDailyCapacityRaw() {
      return state.projectDailyCapacityRaw;
    },
    get capacityDates() {
      return state.capacityDates;
    },
    get teamDailyCapacity() {
      return state.teamDailyCapacity;
    },
    get teamDailyCapacityMap() {
      return state.teamDailyCapacityMap;
    },
    get projectDailyCapacity() {
      return state.projectDailyCapacity;
    },
    get projectDailyCapacityMap() {
      return state.projectDailyCapacityMap;
    },
    get totalOrgDailyCapacity() {
      return state.totalOrgDailyCapacity;
    },
    get totalOrgDailyPerTeamAvg() {
      return state.totalOrgDailyPerTeamAvg;
    },
    get initCompleted() {
      return state.initCompleted;
    },
    getEffectiveFeatures: () => state.getEffectiveFeatures(),
    getEffectiveFeatureById: (id) => state.getEffectiveFeatureById(id),
    getEffectiveSelectedProjectIds: () => state.getEffectiveSelectedProjectIds(),
    getExpandedFeatureIds: () => state.getExpandedFeatureIds(),
    getFeatureTitleById: (id) => state.getFeatureTitleById(id),
    getFeatureStateColor: (stateName) => state.getFeatureStateColor(stateName),
    getFeatureStateColors: () => state.getFeatureStateColors(),
    getTypeLevel: (type) => state.getTypeLevel(type),
    getTypeDisplayName: (type) => state.getTypeDisplayName(type),
    getIterationsForProject: (projectId) => state.getIterationsForProject(projectId),
    getScenarios: () => state.getScenarios?.() || state.scenarios.list(),
    getActiveScenario: () => state.getActiveScenario(),
    getActiveView: () => state.getActiveView?.() || state.views.getActiveData(),
    captureCurrentView: () => state.captureCurrentView(),
    allCountsForProject: (projectId) => state.allCountsForProject(projectId),
    allCountsForTeam: (teamId) => state.allCountsForTeam(teamId),
    setProjectSelected: (id, selected) => state.setProjectSelected(id, selected),
    setTeamSelected: (id, selected) => state.setTeamSelected(id, selected),
    setProjectsSelectedBulk: (selections) => state.setProjectsSelectedBulk(selections),
    setTeamsSelectedBulk: (selections) => state.setTeamsSelectedBulk(selections),
    setExpansionState: (options) => state.setExpansionState(options),
    setTypeVisibility: (type, visible, suppressEmit) =>
      state.setTypeVisibility(type, visible, suppressEmit),
    isTypeVisible: (type) => state.isTypeVisible(type),
    toggleStateSelected: (stateName) => state.toggleStateSelected(stateName),
    setTimelineScale: (scale) => state.setTimelineScale(scale),
    setDisplayMode: (mode, suppressEmit) => state.setDisplayMode(mode, suppressEmit),
    setCondensedCards: (condensed) => state.setCondensedCards(condensed),
    setFeatureSortMode: (mode) => state.setFeatureSortMode(mode),
    setCapacityViewMode: (mode) => state.setCapacityViewMode(mode),
    setShowDependencies: (visible) => state.setShowDependencies(visible),
    setSidebarDisabledElements: (controls) => state.setSidebarDisabledElements(controls),
    clearSidebarDisabledElements: () => state.clearSidebarDisabledElements(),
    updateFeatureDates: (updates) =>
      callPlannerApi('updateFeatureDates', state.updateFeatureDates.bind(state), updates),
    updateFeatureField: (id, field, value) =>
      callPlannerApi('updateFeatureField', state.updateFeatureField.bind(state), id, field, value),
    updateFeatureRelations: (id, relations) => state.updateFeatureRelations(id, relations),
    revertFeature: (id) => state.revertFeature(id),
    createGroupInScenario: (planId, name, color = null, parentId = null) =>
      state.createGroupInScenario(planId, name, color, parentId),
    updateGroupInScenario: (groupId, fields) => state.updateGroupInScenario(groupId, fields),
    deleteGroupInScenario: (groupId) => state.deleteGroupInScenario(groupId),
  };

  return Object.freeze(api);
}
