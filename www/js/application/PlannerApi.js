/**
 * Versioned public application API for plugins and UI controllers.
 *
 * The first version delegates to the legacy State facade during migration. New
 * integrations must use this API rather than importing State or internal
 * services, allowing the facade to be removed once first-party consumers move.
 */
export const PLANNER_API_VERSION = 1;

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

export function createPlannerApi({ runtime: state, commands, selectors }) {
  if (!state) throw new TypeError('PlannerApi requires an application state adapter');
  if (!commands || !selectors) {
    throw new TypeError('PlannerApi requires application commands and selectors');
  }

  function readCapacitySnapshot() {
    if (typeof selectors.capacitySnapshot === 'function') {
      return selectors.capacitySnapshot();
    }
    return {
      dates: state.capacityDates || [],
      teamDaily: state.teamDailyCapacity || [],
      teamDailyMap: state.teamDailyCapacityMap || [],
      projectDailyRaw: state.projectDailyCapacityRaw || [],
      projectDaily: state.projectDailyCapacity || [],
      projectDailyMap: state.projectDailyCapacityMap || [],
      organizationDaily: state.totalOrgDailyCapacity || [],
      organizationDailyPerTeamAverage: state.totalOrgDailyPerTeamAvg || [],
    };
  }

  const api = {
    version: PLANNER_API_VERSION,
    features: Object.freeze({
      list: () => state.getEffectiveFeatures(),
      getById: (id) => state.getEffectiveFeatureById(id),
      getTitle: (id) => state.getFeatureTitleById(id),
      getBaselineById: (id) => state.baselineFeatureById?.get?.(id),
      getBaseline: () => state.baselineFeatures,
      getChildrenByParent: () => state.childrenByParent,
      updateDates: (updates) => commands.updateFeatureDates(updates),
      updateField: (id, field, value) => commands.updateFeatureField(id, field, value),
      updateRelations: (id, relations) => commands.updateFeatureRelations(id, relations),
      revert: (id) => commands.revertFeature(id),
      passesTaskFilters: (feature) => state.taskFilterService.featurePassesFilters(feature),
    }),
    selection: Object.freeze({
      getProjects: () => selectors.projects(),
      getTeams: () => selectors.teams(),
      selectProject: (id, selected) => commands.setProjectSelected(id, selected),
      selectTeam: (id, selected) => commands.setTeamSelected(id, selected),
      setProjects: (selections) => commands.setProjectsSelectedBulk(selections),
      setTeams: (selections) => commands.setTeamsSelectedBulk(selections),
      getExpandedFeatureIds: () => selectors.expandedFeatureIds(),
      getChildrenByParent: () => state.childrenByParent,
      getExpansionState: () => {
        const expansion = selectors.view().expansion;
        return {
          expandParentChild: !!expansion.parentChild,
          expandRelations: !!expansion.relations,
          expandTeamAllocated: !!expansion.teamAllocated,
        };
      },
    }),
    filters: Object.freeze({
      getFeatureStates: () => Array.from(state.selectedFeatureStateFilter || []),
      isFeatureStateSelected: (stateName) =>
        !!state.selectedFeatureStateFilter?.has?.(stateName),
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
      getEffectiveSelectedProjectIds: () => state.getEffectiveSelectedProjectIds(),
      getShowUnplannedWork: () => state.showUnplannedWork,
      getShowUnallocatedCards: () => state.showUnallocatedCards,
      getShowOnlyProjectHierarchy: () => state.showOnlyProjectHierarchy,
      getIterationsForProject: (projectId) => state.getIterationsForProject(projectId),
      getIterationResolutionForProject: (projectId) =>
        state.getIterationResolutionForProject(projectId),
      setTimelineScale: (scale) => state.setTimelineScale(scale),
      getDisplayMode: () => state.displayMode,
      setDisplayMode: (mode, suppressEmit) => state.setDisplayMode(mode, suppressEmit),
      getPackedMode: () => state.packedMode,
      getFeatureSortMode: () => state.featureSortMode,
      setFeatureSortMode: (mode) => state.setFeatureSortMode(mode),
      getHighlightFeatureRelationMode: () => state.highlightFeatureRelationMode,
      setCapacityMode: (mode) => state.setCapacityViewMode(mode),
      getHiddenTypes: () => Array.from(state.hiddenTypes || []),
      setExpansion: (options) => commands.setExpansionState(options),
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
      activate: (id) => commands.activateScenario(id),
      clone: (sourceId, name) => commands.cloneScenario(sourceId, name),
      rename: (id, name) => commands.renameScenario(id, name),
      delete: (id) => commands.deleteScenario(id),
      save: (id) => commands.saveScenario(id),
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
        commands.createGroupInScenario(planId, name, color, parentId),
      updateInScenario: (groupId, fields) => commands.updateGroupInScenario(groupId, fields),
      deleteInScenario: (groupId) => commands.deleteGroupInScenario(groupId),
      applyMemberDelta: (groupId, taskId, op) =>
        commands.applyGroupMemberDelta(groupId, taskId, op),
      publishBaseline: (features) => state.groups.publishBaseline(features),
    }),
    capacity: Object.freeze({
      get: () => {
        const snapshot = readCapacitySnapshot();
        return {
          dates: snapshot.dates,
          teamDailyCapacity: snapshot.teamDaily,
          teamDailyCapacityMap: snapshot.teamDailyMap,
          projectDailyCapacityRaw: snapshot.projectDailyRaw,
          projectDailyCapacity: snapshot.projectDaily,
          projectDailyCapacityMap: snapshot.projectDailyMap,
          totalOrgDailyCapacity: snapshot.organizationDaily,
          totalOrgDailyPerTeamAvg: snapshot.organizationDailyPerTeamAverage,
        };
      },
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
    app: Object.freeze({
      initCompleted: () => state.initCompleted,
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
  };

  return Object.freeze(api);
}
