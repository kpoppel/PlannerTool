import { bus } from '../core/EventBus.js';
import { dataService } from './dataService.js';
import { featureFlags } from '../config.js';
import { FilterManager } from './FilterManager.js';
import { CapacityCalculator } from './CapacityCalculator.js';
import { BaselineStore } from './BaselineStore.js';
import { ScenarioManager } from './ScenarioManager.js';
import { FeatureService } from './FeatureService.js';
import { ViewService } from './ViewService.js';
import { TaskFilterService } from './TaskFilterService.js';
import { ColorService } from './ColorService.js';
import { ConfigService } from './ConfigService.js';
import { StateFilterService } from './StateFilterService.js';
import { FeatureStateService } from './FeatureStateService.js';
import { ProjectTeamService } from './ProjectTeamService.js';
import { DataInitService } from './DataInitService.js';
import { ScenarioEventService } from './ScenarioEventService.js';
import { ViewManagementService } from './ViewManagementService.js';
import { PluginStateService } from './PluginStateService.js';
export { PALETTE, DEFAULT_STATE_COLOR_MAP } from './ColorService.js';
import {
  FeatureEvents,
  //ScenarioEvents,
  ProjectEvents,
  TeamEvents,
  FilterEvents,
  CapacityEvents,
  DataEvents,
  GroupEvents,
  //TimelineEvents,
  //ConfigEvents,
  //StateFilterEvents,
  //ViewEvents,
} from '../core/EventRegistry.js';

class State {
  constructor() {
    // Immutable baseline data
    this.baselineProjects = [];
    this.baselineTeams = [];
    this.baselineFeatures = [];

    // FilterManager - lazy init after data loads
    this._filterManager = null;

    // ScenarioManager - lazy init
    this._scenarioManager = null;

    // FeatureService - lazy init after scenario manager
    this._featureService = null;

    // ========== Service Layer ==========
    // Core services
    this._baselineStore = new BaselineStore();
    this._capacityCalculator = new CapacityCalculator(bus);

    // View and configuration services
    this._viewService = new ViewService(bus);
    // TaskFilterService manages dimensional task filters.
    this._taskFilterService = new TaskFilterService(bus);
    this._colorService = new ColorService(dataService);
    this._configService = new ConfigService(bus, dataService);
    this._stateFilterService = new StateFilterService(bus);

    // FeatureStateService: single source of truth for state names and their categories
    this._featureStateService = new FeatureStateService();

    // Project/team management service
    this._projectTeamService = new ProjectTeamService(bus);

    // Data initialization service
    this._dataInitService = new DataInitService(
      bus,
      dataService,
      this._baselineStore,
      this._projectTeamService,
      this._stateFilterService,
      this._featureStateService,
      this._colorService
    );

    // Initialize ScenarioManager early for ScenarioEventService
    this._initScenarioManager();

    // Scenario event service
    this._scenarioEventService = new ScenarioEventService(
      bus,
      this._scenarioManager,
      this._viewService
    );

    // View management service
    this._viewManagementService = new ViewManagementService(bus, this, this._viewService);
    // Plugin state service (in-memory session store for plugin UI state)
    this._pluginStateService = new PluginStateService(bus, dataService);

    // On page load, scenarios are fetched from the backend and broadcast via
    // SCENARIOS_DATA.  Emit GroupEvents.CHANGED so the board re-renders with
    // any scenario-local groups (scenario.scenarioGroups) that were saved.
    bus.on(DataEvents.SCENARIOS_DATA, () => {
      const activeId = this._getScenarioManager().activeScenarioId;
      const activeScen = this._scenarioEventService.getScenarioById(activeId);
      if ((activeScen?.scenarioGroups || []).length > 0 ||
          Object.keys(activeScen?.groupOverrides || {}).length > 0) {
        bus.emit(GroupEvents.CHANGED, { op: 'restored' });
      }
    });

    // Capacity metrics
    this.capacityDates = [];
    this.teamDailyCapacity = [];
    this.teamDailyCapacityMap = [];
    this.projectDailyCapacityRaw = [];
    this.projectDailyCapacityMap = [];
    this.projectDailyCapacity = [];
    this.totalOrgDailyCapacity = [];
    this.totalOrgDailyPerTeamAvg = [];

    // ConfigService handles autosave initialization and configuration changes
    // Register the autosave callback - ConfigService will handle timer management
    this._configService.setupAutosave(
      this._configService.autosaveIntervalMin,
      () => this._performAutosave(),
      true // silent = true on initial setup to avoid emitting event
    );

    // Promise that resolves when initState completes. Consumers may await
    // `state._initCompleted` to ensure persisted view state and other
    // initialization work has finished before proceeding.
    this._initCompleted = new Promise((resolve) => {
      this._resolveInit = resolve;
    });

    // Dataset expansion state
    this._expansionState = {
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    };
    // Sidebar disabled controls map
    // shape: { taskFilters: { <dim>: [optKey,...] }, taskTypes: [type,...], expansion: ["parentChild","relations","teamAllocated"] }
    this._sidebarDisabled = {};

    // Cache for expanded feature IDs
    this._expandedFeatureIdsCache = null;
    // Cache for available task types (computed from baselineFeatures)
    this._availableTaskTypesCache = null;
    // Cache for the merged task type hierarchy from loaded projects
    this._taskTypeHierarchyCache = null;
  }

  // ViewService properties
  get timelineScale() {
    return this._viewService.timelineScale;
  }
  get hiddenTypes() {
    return this._viewService.hiddenTypes;
  }
  isTypeVisible(type) {
    return this._viewService.isTypeVisible(type);
  }
  get showDependencies() {
    return this._viewService.showDependencies;
  }
  get capacityViewMode() {
    return this._viewService.capacityViewMode;
  }
  get featureSortMode() {
    return this._viewService.featureSortMode;
  }
  get highlightFeatureRelationMode() {
    return this._viewService.highlightFeatureRelationMode;
  }

  // TaskFilterService properties
  get taskFilterService() {
    return this._taskFilterService;
  }

  // ConfigService properties
  get autosaveIntervalMin() {
    return this._configService.autosaveIntervalMin;
  }
  get autosaveTimer() {
    return this._configService._autosaveTimer;
  }

  // ColorService properties
  get defaultStateColorMap() {
    return this._colorService.defaultStateColorMap;
  }

  // StateFilterService properties
  get availableFeatureStates() {
    return this._stateFilterService.availableFeatureStates;
  }
  get selectedFeatureStateFilter() {
    return this._stateFilterService.selectedFeatureStateFilter;
  }

  // FeatureStateService — state metadata (names + category mappings)
  get featureStateService() {
    return this._featureStateService;
  }

  // ProjectTeamService properties
  get projects() {
    return this._projectTeamService.getProjects();
  }
  get teams() {
    return this._projectTeamService.getTeams();
  }

  // ScenarioEventService properties
  get scenarios() {
    return this._scenarioEventService.getScenarios();
  }
  get activeScenarioId() {
    return this._scenarioEventService.getActiveScenarioId();
  }
  set activeScenarioId(id) {
    this._scenarioEventService.setActiveScenarioId(id);
  }

  // ViewManagementService properties
  get viewManagementService() {
    return this._viewManagementService;
  }
  get savedViews() {
    return this._viewManagementService.getViews();
  }
  // PluginStateService properties
  get pluginStateService() {
    return this._pluginStateService;
  }
  get activeViewId() {
    return this._viewManagementService.getActiveViewId();
  }

  // Expansion state properties
  get expansionState() {
    return this._expansionState;
  }

  setExpansionState(options) {
    const prevExpandTeamAllocated = this._expansionState.expandTeamAllocated;
    if (options.expandParentChild !== undefined)
      this._expansionState.expandParentChild = options.expandParentChild;
    if (options.expandRelations !== undefined)
      this._expansionState.expandRelations = options.expandRelations;
    if (options.expandTeamAllocated !== undefined)
      this._expansionState.expandTeamAllocated = options.expandTeamAllocated;
    // Invalidate cache
    this._expandedFeatureIdsCache = null;
    // expandTeamAllocated changes the effective project set used for capacity
    // calculation, so we must recompute immediately.
    if (this._expansionState.expandTeamAllocated !== prevExpandTeamAllocated) {
      this.recomputeCapacityMetrics();
    }
  }

  // Sidebar disabled controls API
  getSidebarDisabledElements() {
    return this._sidebarDisabled || {};
  }

  setSidebarDisabledElements(map) {
    this._sidebarDisabled = map || {};
    bus.emit(FilterEvents.CHANGED, {
      disabledSidebar: this._sidebarDisabled,
    });
  }

  clearSidebarDisabledElements() {
    this.setSidebarDisabledElements({});
  }

  // ---- Helpers for plugins / external callers ----
  // Set which task types are selected in the Sidebar. Accepts an array of type names.
  setSelectedTaskTypes(types) {
    const arr = Array.isArray(types) ? Array.from(types) : [];
    bus.emit(FilterEvents.CHANGED, { selectedTaskTypes: arr });
  }

  // Set selected feature states via StateFilterService (re-emit events from the service)
  setSelectedStates(states) {
    this._stateFilterService.setSelectedStates(states);
  }

  // Select or clear all states
  setAllStatesSelected(selectAll) {
    this._stateFilterService.setAllStatesSelected(selectAll);
    // Recompute capacity metrics (graphs) when toggling all/none
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
  }

  // Toggle a single state's selection on/off
  toggleStateSelected(stateName) {
    this._stateFilterService.toggleStateSelected(stateName);
    // Recompute capacity metrics (graphs) whenever state filter changes
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
  }

  /**
   * Returns the project IDs that should feed into capacity calculation and the
   * main graph, taking the current expansion state into account.  When
   * "expand by team allocation" is active, any project that has at least one
   * feature allocated to a selected team is included even if that project is
   * not explicitly selected.  This keeps the capacity graph consistent with
   * the set of feature cards shown on the board.
   * @returns {string[]}
   */
  getEffectiveSelectedProjectIds() {
    const rawSelected = (this.projects || []).filter((p) => p.selected).map((p) => p.id);
    if (!this._expansionState.expandTeamAllocated) return rawSelected;

    const selectedTeams = (this.teams || []).filter((t) => t.selected).map((t) => t.id);
    if (selectedTeams.length === 0) return rawSelected;

    const featureService = this._getFeatureService();
    if (!featureService || !featureService.expandTeamAllocated) return rawSelected;

    // Collect the project of every feature allocated to a selected team
    const teamAllocatedIds = featureService.expandTeamAllocated(selectedTeams);
    const allFeatures = featureService.getEffectiveFeatures();
    const featureById = new Map(allFeatures.map((f) => [f.id, f]));
    const derived = new Set(rawSelected);
    for (const fid of teamAllocatedIds) {
      const f = featureById.get(fid);
      if (f && f.project) derived.add(f.project);
    }
    return Array.from(derived);
  }

  /**
   * Get expanded feature IDs based on current expansion state
   * @returns {Set<string>} Set of feature IDs that pass expansion filters
   */
  getExpandedFeatureIds() {
    // Return cached result if available
    if (this._expandedFeatureIdsCache) return this._expandedFeatureIdsCache;

    const featureService = this._getFeatureService();
    if (!featureService || !featureService.getEffectiveFeatures) {
      return new Set();
    }

    const allFeatures = featureService.getEffectiveFeatures();
    const selectedProjectIds = this.projects
      .filter((p) => p && p.selected)
      .map((p) => p.id);
    const selectedFeatureIds = new Set(
      allFeatures.filter((f) => selectedProjectIds.includes(f.project)).map((f) => f.id)
    );

    // If no expansion filters are active, return base selected set
    if (
      !this._expansionState.expandParentChild &&
      !this._expansionState.expandRelations &&
      !this._expansionState.expandTeamAllocated
    ) {
      this._expandedFeatureIdsCache = selectedFeatureIds;
      return selectedFeatureIds;
    }

    const selectedTeamIds = this.teams.filter((t) => t && t.selected).map((t) => t.id);
    const expansionResult = featureService.computeExpandedFeatureSet(selectedFeatureIds, {
      expandParentChild: this._expansionState.expandParentChild,
      expandRelations: this._expansionState.expandRelations,
      expandTeamAllocated: this._expansionState.expandTeamAllocated,
      selectedTeamIds: selectedTeamIds,
    });

    this._expandedFeatureIdsCache = expansionResult.expandedIds;
    return expansionResult.expandedIds;
  }
  // FeatureService accessor (lazy-initialized via _getFeatureService)
  get featureService() {
    return this._getFeatureService();
  }

  // DataInitService properties
  get baselineFeatureById() {
    return this._dataInitService.baselineFeatureById;
  }
  get childrenByParent() {
    return this._dataInitService.getChildrenByParentMap();
  }
  get iterations() {
    return this._dataInitService.iterationsByProject || {};
  }
  getIterationsForProject(projectId) {
    if (!projectId) return [];
    const group = this.iterations[String(projectId)];
    return Array.isArray(group?.iterations) ? group.iterations : [];
  }

  // Available task types derived from baseline features
  get availableTaskTypes() {
    try {
      // TODO: (HIGH PRIORITY) Prefer server-provided `task_types` in project
      // configuration. Currently we fall back to deriving the list from the
      // loaded baseline features when the server hasn't provided types.
      // This is a temporary compatibility measure and must be replaced with
      // explicit transfer of `task_types` from the backend.
      if (this._availableTaskTypesCache && Array.isArray(this._availableTaskTypesCache))
        return this._availableTaskTypesCache;
      // Derive from baseline features if cache is null/empty
      const baseline = this.baselineFeatures || [];
      const types = new Set();
      baseline.forEach((f) => {
        const t = f.type || f.workItemType || f.work_item_type || null;
        if (t) types.add(String(t));
      });
      this._availableTaskTypesCache = Array.from(types).sort();
      return this._availableTaskTypesCache;
    } catch (e) {
      this._availableTaskTypesCache = [];
      return [];
    }
  }

  /**
   * Merged task type hierarchy from all loaded projects.
   * Returns the first non-empty hierarchy found across baselineProjects.
   * Shape: Array<{ types: string[] }>, ordered from root to leaf.
   */
  get taskTypeHierarchy() {
    if (this._taskTypeHierarchyCache !== null) return this._taskTypeHierarchyCache;
    const projects = this.baselineProjects || [];
    for (const p of projects) {
      if (Array.isArray(p.task_type_hierarchy) && p.task_type_hierarchy.length > 0) {
        this._taskTypeHierarchyCache = p.task_type_hierarchy;
        return this._taskTypeHierarchyCache;
      }
    }
    this._taskTypeHierarchyCache = [];
    return this._taskTypeHierarchyCache;
  }

  /**
   * Returns the 0-based hierarchy level for a given type name.
   * Types not found in the hierarchy return 9999 (sorts to end).
   * @param {string} type
   * @returns {number}
   */
  getTypeLevel(type) {
    const hierarchy = this.taskTypeHierarchy;
    const key = String(type || '').toLowerCase();
    for (let i = 0; i < hierarchy.length; i++) {
      const types = (hierarchy[i].types || []).map((t) => String(t).toLowerCase());
      if (types.includes(key)) return i;
    }
    return 9999;
  }

  /**
   * Returns the canonical display name for a type as configured in the hierarchy
   * (preserving the capitalisation set by the admin). Falls back to the raw string
   * when the type is not found in the hierarchy.
   * @param {string} type
   * @returns {string}
   */
  getTypeDisplayName(type) {
    const hierarchy = this.taskTypeHierarchy;
    const key = String(type || '').toLowerCase();
    for (const level of hierarchy) {
      const canonical = (level.types || []).find((t) => String(t).toLowerCase() === key);
      if (canonical !== undefined) return canonical;
    }
    return type;
  }

  /**
   * Available task types ordered by their position in the task type hierarchy.
   * Types not present in the hierarchy are appended at the end alphabetically.
   * Falls back to alphabetical order when no hierarchy is configured.
   * Display names are normalised to use the capitalisation from the hierarchy.
   */
  get availableTaskTypesOrdered() {
    const all = this.availableTaskTypes || [];
    if (!this.taskTypeHierarchy.length) return all;
    return [...all]
      .sort((a, b) => {
        const la = this.getTypeLevel(a);
        const lb = this.getTypeLevel(b);
        if (la !== lb) return la - lb;
        return a.localeCompare(b);
      })
      .map((t) => this.getTypeDisplayName(t));
  }

  // ========== Autosave Helper ==========

  /**
   * Perform autosave of all unsaved scenarios
   * @private
   */
  _performAutosave() {
    // Autosave any non-readonly scenarios with unsaved changes
    for (const s of this.scenarios) {
      if (s.readonly) continue; // Skip readonly scenarios
      if (this._scenarioEventService.isScenarioUnsaved(s)) {
        dataService.saveScenario(s).catch(() => {});
      }
    }
  }

  // Return a hex color for a given state name. Lookup in default map first,
  // then fallback to selecting a color from PALETTE deterministically.
  getFeatureStateColor(stateName) {
    return this._colorService.getFeatureStateColor(stateName);
  }

  // Return a hex color for a given project id. If the project exists in the
  // working `this.projects` array and has a `color` property, return it.
  // Otherwise pick a deterministic color from `PALETTE` based on the id.
  getProjectColor(projectId) {
    return this._colorService.getProjectColor(
      projectId,
      this.projects,
      this.baselineProjects
    );
  }

  // Return a mapping of state name -> { background, text } colors for all
  // available states. Uses `getFeatureStateColor` for background and picks either
  // black or white for readable text depending on contrast.
  getFeatureStateColors() {
    return this._colorService.getFeatureStateColors(this.availableFeatureStates);
  }

  async initColors() {
    await this._colorService.initColors(this.projects, this.teams);
  }

  // Compute organization load for a feature based on selected teams.
  // Returns a percentage string like '45.0%'.
  computeFeatureOrgLoad(feature) {
    return this._projectTeamService.computeFeatureOrgLoad(feature);
  }

  async initState() {
    // Delegate to DataInitService
    const result = await this._dataInitService.initState();

    // Sync loaded baseline data to state properties
    this.baselineProjects = result.baselineProjects;
    this.baselineTeams = result.baselineTeams;
    this.baselineFeatures = result.baselineFeatures;
    // Populate available task types. Clear the cache first so the getter always
    // re-derives from the freshly-loaded features
    this._availableTaskTypesCache = null;
    // Invalidate the hierarchy cache so it is recomputed from the newly
    // loaded project data (which may now include task_type_hierarchy).
    this._taskTypeHierarchyCache = null;

    // Update FeatureService with new childrenByParent if it exists
    if (this._featureService) {
      this._featureService.setChildrenByParent(this.childrenByParent);
    }

    // Initialize default scenario
    this._scenarioEventService.initDefaultScenario(() =>
      this._projectTeamService.captureCurrentFilters()
    );

    // Emit scenario events before loading views
    this._scenarioEventService.emitScenarioList();
    this._scenarioEventService.emitScenarioActivated();

    // Initialize plugin state service so plugins can read state during view load/restore
    await this._pluginStateService.init();

    // Load saved views
    await this._viewManagementService.loadViews();

    // Restore the last active view (or default view if none)
    // This will apply project/team selections and view options
    await this._viewManagementService.restoreLastView();

    // Calculate initial capacity metrics now that all data is loaded and selections are restored
    this.recomputeCapacityMetrics();

    // Signal that initState has completed so other components waiting on
    // restored view state (eg. timeline) can proceed deterministically.
    this._resolveInit(true);
  }

  async refreshBaseline() {
    // Delegate to DataInitService (no cache invalidation — used after scenario push)
    const result = await this._dataInitService.refreshBaseline();

    // Sync to state properties
    this.baselineProjects = result.baselineProjects;
    this.baselineTeams = result.baselineTeams;
    this.baselineFeatures = result.baselineFeatures;

    // Update FeatureService with new childrenByParent if it exists
    if (this._featureService) {
      this._featureService.setChildrenByParent(this.childrenByParent);
    }

    // Reinitialize default scenario
    this._scenarioEventService.initDefaultScenario(() =>
      this._projectTeamService.captureCurrentFilters()
    );

    this._scenarioEventService.emitScenarioList();
    this._scenarioEventService.emitScenarioActivated();

    // Recompute capacity metrics after refresh
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
  }

  /**
   * Invalidate the server cache then reload the baseline.
   * Use for explicit user-triggered refresh actions.
   */
  async invalidateAndRefreshBaseline() {
    // Delegate invalidation to DataInitService, then follow the same
    // post-processing path as refreshBaseline().
    const result = await this._dataInitService.invalidateAndRefreshBaseline();

    this.baselineProjects = result.baselineProjects;
    this.baselineTeams = result.baselineTeams;
    this.baselineFeatures = result.baselineFeatures;

    if (this._featureService) {
      this._featureService.setChildrenByParent(this.childrenByParent);
    }

    this._scenarioEventService.initDefaultScenario(() =>
      this._projectTeamService.captureCurrentFilters()
    );
    this._scenarioEventService.emitScenarioList();
    this._scenarioEventService.emitScenarioActivated();

    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
  }

  setStateFilter(stateName) {
    this._stateFilterService.setStateFilter(stateName);
    // Recompute capacity metrics when filter changes
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
  }

  // Dirty/changed fields now derived against baseline when creating effective feature objects.
  recomputeDerived(featureBase, override) {
    const changedFields = [];
    if (override) {
      if (override.start && override.start !== featureBase.start)
        changedFields.push('start');
      if (override.end && override.end !== featureBase.end) changedFields.push('end');
      if (
        override.capacity &&
        JSON.stringify(override.capacity) !== JSON.stringify(featureBase.capacity)
      )
        changedFields.push('capacity');
    }
    return { changedFields, dirty: changedFields.length > 0 };
  }

  getFeatureStatuses() {
    return this.availableFeatureStates;
  }

  getStateDisplaySequence() {
    return this._featureStateService.getConfiguredSequence();
  }

  compareFeatureStates(a, b) {
    return this._featureStateService.compareStates(a, b);
  }

  /**
   * Return a Map<type, count> of all task types for a given project.
   * @param {string} projectId
   * @returns {Map<string, number>}
   */
  allCountsForProject(projectId) {
    return this._getFeatureService().allCountsForProject(projectId);
  }

  /**
   * Return a Map<type, count> of all task types for a given team.
   * @param {string} teamId
   * @returns {Map<string, number>}
   */
  allCountsForTeam(teamId) {
    return this._getFeatureService().allCountsForTeam(teamId);
  }

  // Bulk update the state
  updateFeatureDates(updates) {
    const capacityCallback = () => {
      const changedIds =
        Array.isArray(updates) ? updates.map((u) => u.id).filter(Boolean) : [];
      this.recomputeCapacityMetrics(changedIds.length ? changedIds : null);
      this._emitCapacityUpdated();
    };

    const updateCount = this._getFeatureService().updateFeatureDates(
      updates,
      capacityCallback
    );

    if (updateCount > 0) {
      const activeId = this._getScenarioManager().activeScenarioId;
      this.emitScenarioUpdated(activeId, {
        type: 'overrideBatch',
        count: updateCount,
      });
    }
  }

  updateFeatureField(id, field, value) {
    const capacityCallback = () => {
      this.recomputeCapacityMetrics([id]);
      this._emitCapacityUpdated();
    };

    const updated = this._getFeatureService().updateFeatureField(
      id,
      field,
      value,
      capacityCallback
    );

    if (updated) {
      const activeId = this._getScenarioManager().activeScenarioId;
      this.emitScenarioUpdated(activeId, {
        type: 'overrideField',
        featureId: id,
        field,
      });
    }
  }

  revertFeature(id) {
    const capacityCallback = () => {
      this.recomputeCapacityMetrics([id]);
      this._emitCapacityUpdated();
    };

    const reverted = this._getFeatureService().revertFeature(id, capacityCallback);

    if (reverted) {
      const activeId = this._getScenarioManager().activeScenarioId;
      this.emitScenarioUpdated(activeId, { type: 'revert', featureId: id });
    }
  }

  // Ensure FilterManager is initialized
  _ensureFilterManager() {
    if (!this._filterManager && this.projects && this.teams) {
      this._filterManager = new FilterManager(bus, this.projects, this.teams);
    }
  }

  setProjectSelected(id, selected) {
    this._ensureFilterManager();
    if (!this._projectTeamService.setProjectSelected(id, selected)) return;
    // Invalidate expansion cache since project selection changed
    this._expandedFeatureIdsCache = null;
    // Notify UI listeners of project list change (single consolidated event)
    bus.emit(ProjectEvents.CHANGED, this.projects);
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
    this._emitFeatureUpdated();
  }

  setTeamSelected(id, selected) {
    this._ensureFilterManager();
    if (!this._projectTeamService.setTeamSelected(id, selected)) return;
    // Invalidate expansion cache since team selection changed
    this._expandedFeatureIdsCache = null;
    // Notify UI listeners of team list change (single consolidated event)
    bus.emit(TeamEvents.CHANGED, this.teams);
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
    this._emitFeatureUpdated();
  }

  /**
   * Apply multiple project selection changes at once and emit a single update.
   * @param {Object} selections - Mapping of projectId -> boolean
   */
  setProjectsSelectedBulk(selections) {
    this._ensureFilterManager();
    const changed = this._projectTeamService.setProjectsSelectedBulk(selections);
    if (!changed) return;
    // Invalidate expansion cache since project selection changed
    this._expandedFeatureIdsCache = null;
    // Notify listeners that project selection changed (single consolidated event)
    bus.emit(ProjectEvents.CHANGED, this.projects);
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
    this._emitFeatureUpdated();
  }

  /**
   * Apply multiple team selection changes at once and emit a single update.
   * @param {Object} selections - Mapping of teamId -> boolean
   */
  setTeamsSelectedBulk(selections) {
    this._ensureFilterManager();
    const changed = this._projectTeamService.setTeamsSelectedBulk(selections);
    if (!changed) return;
    // Invalidate expansion cache since team selection changed
    this._expandedFeatureIdsCache = null;
    // Notify listeners that team selection changed (single consolidated event)
    bus.emit(TeamEvents.CHANGED, this.teams);
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
    this._emitFeatureUpdated();
  }

  setTimelineScale(scale) {
    this._viewService.setTimelineScale(scale);
  }

  setTypeVisibility(type, visible) {
    this._viewService.setTypeVisibility(type, visible);
  }

  setShowDependencies(val) {
    this._viewService.setShowDependencies(val);
  }

  setCapacityViewMode(mode) {
    this._viewService.setCapacityViewMode(mode);
  }

  setFeatureSortMode(mode) {
    this._viewService.setFeatureSortMode(mode);
  }

  setHighlightFeatureRelationMode(mode) {
    this._viewService.setHighlightFeatureRelationMode(mode);
  }

  // ---------- Scenario State Management ----------

  // Initialize scenario manager
  _initScenarioManager() {
    if (this._scenarioManager) return;

    // Create state context for ScenarioManager
    const stateContext = {
      captureCurrentFilters: () => this.captureCurrentFilters(),
      captureCurrentView: () => this.captureCurrentView(),
    };

    this._scenarioManager = new ScenarioManager(bus, this._baselineStore, stateContext);
  }

  // Get or create scenario manager (lazy initialization)
  _getScenarioManager() {
    this._initScenarioManager();
    return this._scenarioManager;
  }

  _getFeatureService() {
    if (!this._featureService) {
      // FeatureService requires BaselineStore and a way to get active scenario
      const getActiveScenarioFn = () => {
        return this.scenarios.find((s) => s.id === this.activeScenarioId);
      };

      // Allow swapping in an experimental queued implementation via feature flag
      if (featureFlags && featureFlags.USE_QUEUED_FEATURE_SERVICE) {
        // Dynamic import preserves module semantics and avoids circular import issues
        // Note: dynamic import returns a promise; use then() to synchronously assign when available.
        import('./QueuedFeatureService.js').then((mod) => {
          this._featureService = new mod.QueuedFeatureService(
            this._baselineStore,
            getActiveScenarioFn
          );
        });
      } else {
        this._featureService = new FeatureService(
          this._baselineStore,
          getActiveScenarioFn
        );
      }
      // Provide fallback to baselineFeatures if BaselineStore returns empty
      this._featureService._getBaselineFallback = () => this.baselineFeatures;
      this._featureService.setChildrenByParent(this.childrenByParent);
      this._featureService.setProjectTeamService(this._projectTeamService);
    }
    return this._featureService;
  }

  captureCurrentFilters() {
    return this._projectTeamService.captureCurrentFilters();
  }

  captureCurrentView() {
    return this._viewService.captureCurrentView();
  }

  emitScenarioList() {
    this._scenarioEventService.emitScenarioList();
  }

  emitScenarioActivated() {
    this._scenarioEventService.emitScenarioActivated();
  }

  emitScenarioUpdated(id, change) {
    this._scenarioEventService.emitScenarioUpdated(id, change);
  }

  initDefaultScenario() {
    this._scenarioEventService.initDefaultScenario(() =>
      this._projectTeamService.captureCurrentFilters()
    );
  }

  cloneScenario(sourceId, name) {
    const scenario = this._getScenarioManager().cloneScenario(sourceId, name);

    // Sync scenarios with ScenarioEventService
    this._scenarioEventService.syncScenariosFromManager();

    this._scenarioEventService.emitScenarioList();
    return scenario;
  }

  activateScenario(id) {
    if (this.activeScenarioId === id) return;
    this._getScenarioManager().activateScenario(id);
    this._scenarioEventService.setActiveScenarioId(
      this._getScenarioManager().activeScenarioId
    );
    this._scenarioEventService.emitScenarioActivated();
    // Recompute capacity metrics to reflect active scenario overrides
    this.recomputeCapacityMetrics();
    this._emitCapacityUpdated();
    this._emitFeatureUpdated();

    // Re-render board with the new scenario's effective groups.
    // getEffectiveGroups reads scenario.scenarioGroups and groupOverrides directly.
    bus.emit(GroupEvents.CHANGED, { op: 'scenarioSwitched' });
  }

  renameScenario(id, newName) {
    this._getScenarioManager().renameScenario(id, newName);
    this._scenarioEventService.emitScenarioUpdated(id, {
      type: 'rename',
      name: newName,
    });
  }

  deleteScenario(id) {
    const wasActive = id === this.activeScenarioId;
    this._getScenarioManager().deleteScenario(id);
    this._scenarioEventService.setActiveScenarioId(
      this._getScenarioManager().activeScenarioId
    );

    // Sync scenarios with ScenarioEventService
    this._scenarioEventService.syncScenariosFromManager();

    this._scenarioEventService.emitScenarioUpdated(id, { type: 'delete' });
    if (wasActive) {
      this._scenarioEventService.emitScenarioActivated();
    }
    this._emitFeatureUpdated();
  }

  setScenarioOverride(featureId, start, end) {
    this._getScenarioManager().setScenarioOverride(featureId, start, end);
    const activeId = this._getScenarioManager().activeScenarioId;
    if (activeId !== 'baseline') {
      this._scenarioEventService.emitScenarioUpdated(activeId, {
        type: 'override',
        featureId,
      });
    }
    // Recompute capacity metrics after setting override
    this.recomputeCapacityMetrics([featureId]);
    this._emitCapacityUpdated();
    this._emitFeatureUpdated([featureId]);
  }

  _getCapacityUpdatedPayload() {
    return {
      dates: this.capacityDates,
      teamDailyCapacity: this.teamDailyCapacity,
      teamDailyCapacityMap: this.teamDailyCapacityMap,
      projectDailyCapacityRaw: this.projectDailyCapacityRaw,
      projectDailyCapacity: this.projectDailyCapacity,
      projectDailyCapacityMap: this.projectDailyCapacityMap,
      totalOrgDailyCapacity: this.totalOrgDailyCapacity,
      totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg,
    };
  }

  _emitCapacityUpdated() {
    bus.emit(CapacityEvents.UPDATED, this._getCapacityUpdatedPayload());
  }

  _emitFeatureUpdated(ids = []) {
    bus.emit(FeatureEvents.UPDATED, { ids: Array.isArray(ids) ? ids.filter(Boolean) : [] });
  }

  getEffectiveFeatures() {
    return this._getFeatureService().getEffectiveFeatures();
  }

  getEffectiveFeatureById(id) {
    return this._getFeatureService().getEffectiveFeatureById(id);
  }

  getFeatureTitleById(id) {
    return this._getFeatureService().getFeatureTitleById(id);
  }

  isScenarioUnsaved(scen) {
    return this._scenarioEventService.isScenarioUnsaved(scen);
  }

  // ---------------------------------------------------------------------------
  // Pending group changes — derived from scenario.scenarioGroups + groupOverrides
  // ---------------------------------------------------------------------------

  /**
   * Return a snapshot of all pending group changes for the active scenario.
   *
   * Shape: Array<{ type: 'create'|'update'|'delete', group?, groupId?, fields? }>
   *
   * Creates come from scenario.scenarioGroups (groups not yet promoted to baseline).
   * Updates/deletes come from scenario.groupOverrides entries.
   *
   * @returns {Array}
   */
  getPendingGroupChanges() {
    const activeScen = this.getActiveScenario();
    const ops = [];

    // Creates: groups in scenario.scenarioGroups
    for (const g of (activeScen?.scenarioGroups || [])) {
      ops.push({ type: 'create', group: g });
    }

    // Deletes/updates from groupOverrides
    for (const [groupId, ov] of Object.entries(activeScen?.groupOverrides || {})) {
      if (ov._deleted) {
        ops.push({ type: 'delete', groupId });
      } else {
        const { _deleted, memberDeltas, ...fields } = ov;
        const hasFields = Object.keys(fields).length > 0;
        const hasDeltas = memberDeltas?.length > 0;
        if (hasFields || hasDeltas) {
          ops.push({
            type: 'update',
            groupId,
            ...(hasFields && { fields }),
            ...(hasDeltas && { memberDeltas }),
          });
        }
      }
    }

    return ops;
  }

  /**
   * Clear all pending group changes for the active scenario.
   * Removes scenarioGroups that have been promoted and clears groupOverrides.
   * Called by ScenarioMenu after changes have been persisted to the server.
   */
  clearPendingGroupChanges() {
    const activeScen = this._getActiveWritableScenario();
    if (!activeScen) return;
    activeScen.scenarioGroups = [];
    activeScen.groupOverrides = {};
  }

  /**
   * After a group has been created on the server, swap the temp ID for the
   * real server ID in scenario.scenarioGroups.
   * @param {string} tempId
   * @param {string} realId
   */
  confirmGroupCreate(tempId, realId) {
    const sg = this.getActiveScenario()?.scenarioGroups;
    if (sg) {
      const g = sg.find((g) => g.id === tempId);
      if (g) g.id = realId;
    }
  }

  /** Return the currently active (non-null) scenario object, or null.
   * @returns {object|null}
   */
  getActiveScenario() {
    const id = this.activeScenarioId;
    if (!id) return null;
    return this.scenarios.find((s) => s.id === id) || null;
  }

  /** Return the active writable (non-readonly) scenario, or null. */
  _getActiveWritableScenario() {
    return this.scenarios.find(
      (s) => s.id === this.activeScenarioId && !s.readonly
    ) || null;
  }

  /**
   * Create a new group inside the active scenario (no server call yet).
   * The group is stored in scenario.scenarioGroups until the user publishes.
   * @param {string} planId
   * @param {string} name
   * @param {string} [color]
   * @param {string|null} [parentId]
   * @returns {object|null} The created group, or null if no active scenario.
   */
  createGroupInScenario(planId, name, color = null, parentId = null) {
    const activeScen = this._getActiveWritableScenario();
    if (!activeScen) return null;

    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const group = {
      id: tempId,
      plan_id: String(planId),
      name,
      rank: Date.now(),
      members: [],
      color: color || null,
      parent_id: parentId || null,
    };

    if (!activeScen.scenarioGroups) activeScen.scenarioGroups = [];
    activeScen.scenarioGroups.push(group);
    this._markActiveScenarioChanged();
    bus.emit(GroupEvents.CHANGED, { op: 'created', group });
    return group;
  }

  /**
   * Update a group in the active scenario.
   * - Scenario-local groups (in scenarioGroups): updated in-place.
   * - Baseline groups: override stored in scenario.groupOverrides.
   * @param {string} groupId
   * @param {{ name?: string, color?: string, rank?: number, parent_id?: string }} fields
   * @returns {object|null} Updated group, or null if not found.
   */
  updateGroupInScenario(groupId, fields) {
    const activeScen = this._getActiveWritableScenario();
    if (!activeScen) return null;

    // Check scenario-local groups first
    const sgIdx = (activeScen.scenarioGroups || []).findIndex(
      (g) => String(g.id) === String(groupId)
    );
    if (sgIdx !== -1) {
      activeScen.scenarioGroups[sgIdx] = {
        ...activeScen.scenarioGroups[sgIdx],
        ...fields,
      };
      this._markActiveScenarioChanged();
      bus.emit(GroupEvents.CHANGED, { op: 'updated', group: activeScen.scenarioGroups[sgIdx] });
      return activeScen.scenarioGroups[sgIdx];
    }

    // Baseline group — store as group override
    if (!activeScen.groupOverrides) activeScen.groupOverrides = {};
    activeScen.groupOverrides[String(groupId)] = {
      ...(activeScen.groupOverrides[String(groupId)] || {}),
      ...fields,
    };
    this._markActiveScenarioChanged();
    bus.emit(GroupEvents.CHANGED, { op: 'updated', groupId, fields });
    return activeScen.groupOverrides[String(groupId)];
  }

  /**
   * Delete a group in the active scenario.
   * - Scenario-local groups: removed from scenarioGroups.
   * - Baseline groups: marked deleted in groupOverrides.
   * @param {string} groupId
   */
  deleteGroupInScenario(groupId) {
    const activeScen = this._getActiveWritableScenario();
    if (!activeScen) return;

    // Check scenario-local groups first (and cascade sub-groups)
    const sgList = activeScen.scenarioGroups || [];
    const toRemove = new Set([String(groupId)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const g of sgList) {
        if (g.parent_id && toRemove.has(String(g.parent_id)) && !toRemove.has(String(g.id))) {
          toRemove.add(String(g.id));
          changed = true;
        }
      }
    }
    const hadLocal = sgList.some((g) => toRemove.has(String(g.id)));
    if (hadLocal) {
      activeScen.scenarioGroups = sgList.filter((g) => !toRemove.has(String(g.id)));
      this._markActiveScenarioChanged();
      bus.emit(GroupEvents.CHANGED, { op: 'deleted', groupId });
      return;
    }

    // Baseline group — mark as deleted in groupOverrides
    if (!activeScen.groupOverrides) activeScen.groupOverrides = {};
    activeScen.groupOverrides[String(groupId)] = {
      ...(activeScen.groupOverrides[String(groupId)] || {}),
      _deleted: true,
    };
    this._markActiveScenarioChanged();
    bus.emit(GroupEvents.CHANGED, { op: 'deleted', groupId });
  }

  /**
   * Record a single member add/remove delta for a baseline group.
   * Stored in scenario.groupOverrides[groupId].memberDeltas as an array of
   * { taskId, op: 'add'|'remove' } entries (last write per taskId wins).
   * @param {string} groupId
   * @param {string} taskId
   * @param {'add'|'remove'} op
   */
  applyGroupMemberDelta(groupId, taskId, op) {
    const activeScen = this._getActiveWritableScenario();
    if (!activeScen) return;
    if (!activeScen.groupOverrides) activeScen.groupOverrides = {};
    const ov = activeScen.groupOverrides[String(groupId)] || {};
    const deltas = (ov.memberDeltas || []).filter(
      (d) => String(d.taskId) !== String(taskId)  // last write wins
    );
    deltas.push({ taskId: String(taskId), op });
    activeScen.groupOverrides[String(groupId)] = { ...ov, memberDeltas: deltas };
    this._markActiveScenarioChanged();
    bus.emit(GroupEvents.CHANGED, { op: 'memberDelta', groupId, taskId, delta: op });
  }

  /** Mark the active (non-readonly) scenario as having unsaved changes. */
  _markActiveScenarioChanged() {
    const active = this._getActiveWritableScenario();
    if (active) active.isChanged = true;
    // Re-emit scenario list so the ⚠️ badge updates in the menu
    this._scenarioEventService.emitScenarioList();
  }

  async saveScenario(id) {
    const scen = this._scenarioEventService.getScenarioById(id);
    if (!scen) return;
    // Persist via provider.  Includes:
    //   - overrides: feature-level scenario overrides
    //   - scenarioGroups: groups created in this scenario (promoted to baseline on publish)
    //   - groupOverrides: per-scenario overrides for baseline groups (members, name, color, deleted)
    await dataService.saveScenario({
      id: scen.id,
      name: scen.name,
      overrides: scen.overrides,
      filters: scen.filters,
      view: scen.view,
      scenarioGroups: (scen.scenarioGroups || []).length > 0 ? [...scen.scenarioGroups] : undefined,
      groupOverrides: scen.groupOverrides && Object.keys(scen.groupOverrides).length > 0
        ? { ...scen.groupOverrides }
        : undefined,
    });
    this._scenarioEventService.markScenarioSaved(scen.id);
    this._scenarioEventService.emitScenarioUpdated(scen.id, { type: 'saved' });
  }

  // -------- Capacity Metrics ---------
  // Build per-day capacity spent per team and per project and totals.
  // Delegates to CapacityCalculator service
  // Optional `changedFeatureIds` (Array) allows incremental recalculation when only
  // a small set of features changed.
  recomputeCapacityMetrics(changedFeatureIds = null) {
    const teams = this.baselineTeams || [];
    const projects = this.baselineProjects || [];
    // Always use all projects for capacity calculations to ensure features from all projects are counted.
    // Project type filtering should only affect display/grouping, not calculation.
    const projectsForCapacity = projects || [];
    // Use expansion-aware project IDs so the graph stays populated when
    // "expand by team allocation" makes features visible from unselected plans.
    const selectedProjects = this.getEffectiveSelectedProjectIds();
    const selectedTeams = (this.teams || []).filter((t) => t.selected).map((t) => t.id);
    const selectedStateIds =
      this.selectedFeatureStateFilter instanceof Set ?
        Array.from(this.selectedFeatureStateFilter)
      : this.selectedFeatureStateFilter || [];

    // When GRAPH_ONLY_SELECTED_PLANS is false (default), the capacity graph
    // always reflects ALL plans so overallocation from unselected plans is visible.
    // When true, only features from the user-selected projects are counted (legacy).
    const graphOnlySelected = featureFlags.GRAPH_ONLY_SELECTED_PLANS;
    const projectsForFilter = graphOnlySelected ?
      selectedProjects
    : (this.projects || []).map((p) => p.id);

    // Check for empty selections. When graphOnlySelected is false, project
    // selection on the board is irrelevant to the graph so we skip that check.
    if (
      (graphOnlySelected &&
        this.projects &&
        this.projects.length > 0 &&
        selectedProjects.length === 0) ||
      (this.teams && this.teams.length > 0 && selectedTeams.length === 0) ||
      (this.selectedFeatureStateFilter && selectedStateIds.length === 0)
    ) {
      // Clear metrics
      this.capacityDates = [];
      this.teamDailyCapacity = [];
      this.teamDailyCapacityMap = [];
      this.projectDailyCapacityRaw = [];
      this.projectDailyCapacity = [];
      this.projectDailyCapacityMap = [];
      this.totalOrgDailyCapacity = [];
      this.totalOrgDailyPerTeamAvg = [];
      console.debug(
        '[state] recomputeCapacityMetrics - empty selection -> cleared metrics'
      );
      return;
    }

    // Ensure childrenByParent map is set in calculator
    this._capacityCalculator.setChildrenByParent(
      this._dataInitService.getChildrenByParentMap()
    );

    const filters = {
      selectedProjects: projectsForFilter,
      selectedTeams,
      selectedStates: selectedStateIds,
    };

    // Get effective features with scenario overrides
    const features = this.getEffectiveFeatures();

    // Calculate using service (pass changed ids for incremental update when available)
    const result = this._capacityCalculator.calculate(
      features,
      filters,
      teams,
      projectsForCapacity,
      changedFeatureIds
    );

    // Assign results to state properties
    this.capacityDates = result.dates;
    this.teamDailyCapacity = result.teamDailyCapacity;
    this.teamDailyCapacityMap = result.teamDailyCapacityMap;
    this.projectDailyCapacityRaw = result.projectDailyCapacityRaw;
    this.projectDailyCapacity = result.projectDailyCapacity;
    this.projectDailyCapacityMap = result.projectDailyCapacityMap;
    this.totalOrgDailyCapacity = result.totalOrgDailyCapacity;
    this.totalOrgDailyPerTeamAvg = result.totalOrgDailyPerTeamAvg;

    console.debug(
      '[state] recomputeCapacityMetrics - computed',
      this.capacityDates.length,
      'days of capacity metrics (using CapacityCalculator service)'
    );
  }
}

export const state = new State();
