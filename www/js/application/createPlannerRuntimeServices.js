import { featureFlags } from '../config.js';
import {
  CapacityEvents,
  DataEvents,
  FeatureEvents,
  FilterEvents,
  GroupEvents,
  ProjectEvents,
  TeamEvents,
} from '../core/EventRegistry.js';
import { BaselineStore } from '../services/BaselineStore.js';
import { CapacityCalculator } from '../services/CapacityCalculator.js';
import { CapacityCoordinator } from '../services/CapacityCoordinator.js';
import { ColorService } from '../services/ColorService.js';
import { ConfigService } from '../services/ConfigService.js';
import { dataService as defaultDataService } from '../services/dataService.js';
import { DataInitService } from '../services/DataInitService.js';
import { FeatureService } from '../services/FeatureService.js';
import { FeatureStateService } from '../services/FeatureStateService.js';
import { PluginStateService } from '../services/PluginStateService.js';
import { ProjectTeamService } from '../services/ProjectTeamService.js';
import { QueuedFeatureService } from '../services/QueuedFeatureService.js';
import { ScenarioEventService } from '../services/ScenarioEventService.js';
import { ScenarioGroupService } from '../services/ScenarioGroupService.js';
import { ScenarioManager } from '../services/ScenarioManager.js';
import { StateFilterService } from '../services/StateFilterService.js';
import { TaskFilterService } from '../services/TaskFilterService.js';
import { ViewManagementService } from '../services/ViewManagementService.js';
import { ViewService } from '../services/ViewService.js';
import { dataOr } from '../services/result.js';
import {
  selectAllIds,
  selectSelectedIds,
  selectSelectedStateNames,
} from './selectors/selectionSelectors.js';
import { selectCapacityEventPayload } from './selectors/capacitySelectors.js';
import {
  selectEffectiveSelectedProjectIds,
  selectExpandedFeatureIds,
  selectTeamAllocationExpansionFeatures,
} from './selectors/expansionSelectors.js';
import { selectIterationsForProject } from './selectors/iterationSelectors.js';
import {
  selectActiveScenario,
  selectActiveWritableScenario,
  selectScenarioSavePayload,
  selectUnsavedWritableScenarios,
} from './selectors/scenarioSelectors.js';
import {
  selectAvailableTaskTypes,
  selectOrderedTaskTypes,
  selectTaskTypeDisplayName,
  selectTaskTypeHierarchy,
  selectTaskTypeLevel,
} from './selectors/taskTypeSelectors.js';
import {
  buildRuntimeSnapshot,
  planViewRestoreUiEffects,
  publishRuntimeSnapshot,
} from './runtimeSnapshot.js';

const DEFAULT_ADAPTERS = {
  viewLayout: {
    getTimelineSectionWidth: () => null,
  },
  viewManagement: {
    storage: {
      getItem: () => null,
      setItem: () => {},
    },
    ui: {
      getSidebarElement: () => null,
    },
  },
};

function bindDataPort(dataService, definitions) {
  return Object.fromEntries(
    definitions.map(([name, method, fallback]) => [
      name,
      async (...args) => dataOr(await dataService[method](...args), fallback),
    ])
  );
}

function bindMethodDelegates(target, source, methodNames) {
  for (const methodName of methodNames) {
    target[methodName] = (...args) => source[methodName](...args);
  }
}

function createScenarioPort(runtime) {
  return Object.freeze({
    list: () => runtime.scenarioEventService.getScenarios(),
    activate: (id) => runtime.activateScenario(id),
    rename: (id, name) => runtime.renameScenario(id, name),
    delete: (id) => runtime.deleteScenario(id),
    save: (id) => runtime.saveScenario(id),
    clone: (sourceId, name) => runtime.cloneScenario(sourceId, name),
    getActiveId: () => runtime.activeScenarioId,
    getActive: () => runtime.getActiveScenario(),
  });
}

function createViewPort(runtime) {
  return Object.freeze({
    list: () => runtime.viewManagementService.getViews(),
    save: (name, viewId = null) => runtime.viewManagementService.saveCurrentView(name, viewId),
    rename: (viewId, name) => runtime.viewManagementService.renameView(viewId, name),
    delete: (viewId) => runtime.viewManagementService.deleteView(viewId),
    load: (viewId) => runtime.viewManagementService.loadAndApplyView(viewId),
    restoreLast: () => runtime.viewManagementService.restoreLastView(),
    getActiveId: () => runtime.viewManagementService.getActiveViewId(),
    getActiveData: () => runtime.viewManagementService.getActiveViewData(),
  });
}

function createGroupPort(runtime) {
  return Object.freeze({
    ...bindDataPort(runtime._dataService, [
      ['list', 'listGroups', []],
      ['create', 'createGroup', null],
      ['update', 'updateGroup', null],
      ['delete', 'deleteGroup', false],
      ['publishBaseline', 'publishBaseline', { ok: false }],
    ]),
    getPendingChanges: () => runtime.scenarioGroupService.getPendingChanges(),
    clearPendingChanges: () => runtime.clearPendingGroupChanges(),
    confirmCreate: (tempId, realId) => runtime.confirmGroupCreate(tempId, realId),
    createInScenario: (planId, name, color = null, parentId = null) =>
      runtime.createGroupInScenario(planId, name, color, parentId),
    updateInScenario: (groupId, fields) => runtime.updateGroupInScenario(groupId, fields),
    deleteInScenario: (groupId) => runtime.deleteGroupInScenario(groupId),
    applyMemberDelta: (groupId, taskId, op) => runtime.applyGroupMemberDelta(groupId, taskId, op),
  });
}

function createDataPorts(runtime) {
  return Object.freeze({
    events: Object.freeze(
      bindDataPort(runtime._dataService, [
        ['getAll', 'getEvents', []],
        ['getCategories', 'getEventCategories', []],
        ['create', 'createEvent', null],
        ['update', 'updateEvent', null],
        ['delete', 'deleteEvent', false],
        ['createCategory', 'createEventCategory', null],
        ['updateCategory', 'updateEventCategory', null],
        ['deleteCategory', 'deleteEventCategory', false],
      ])
    ),
    config: Object.freeze({
      ...bindDataPort(runtime._dataService, [
        ['getPref', 'getLocalPref', null],
        ['setPref', 'setLocalPref', undefined],
        ['saveAccountConfig', 'saveConfig', null],
        ['updateProjectColor', 'updateProjectColor', undefined],
        ['updateTeamColor', 'updateTeamColor', undefined],
      ]),
    }),
    plugins: Object.freeze(bindDataPort(runtime._dataService, [
      ['getConfig', 'getPluginsConfig', null],
      ['getSchemas', 'getPluginsSchemas', null],
    ])),
    cost: Object.freeze(bindDataPort(runtime._dataService, [
      ['get', 'getCost', null],
      ['getTeams', 'getCostTeams', []],
      ['updateWorkItemCapacity', 'updateWorkItemCapacity', { ok: false }],
    ])),
    markers: Object.freeze(bindDataPort(runtime._dataService, [['getAll', 'getMarkers', []]])),
    history: Object.freeze(bindDataPort(runtime._dataService, [['get', 'getHistory', { tasks: [] }]])),
    server: Object.freeze(bindDataPort(runtime._dataService, [['health', 'checkHealth', { status: 'error' }]])),
  });
}

function applyBaselineResult(runtime, { baselineProjects, baselineTeams, baselineFeatures }) {
  runtime.baselineProjects = baselineProjects;
  runtime.baselineTeams = baselineTeams;
  runtime.baselineFeatures = baselineFeatures;
  runtime.featureService.setChildrenByParent(runtime.childrenByParent);
}

function resetScenarioAfterBaseline(runtime) {
  runtime.scenarioEventService.initDefaultScenario(() => runtime.captureCurrentFilters());
  runtime.scenarioEventService.emitScenarioList();
  runtime.scenarioEventService.emitScenarioActivated();
}

function recomputeAndEmitCapacity(runtime) {
  if (runtime.recomputeCapacityMetrics()) runtime.emitCapacityUpdated();
}

async function initializeBaseline(runtime) {
  applyBaselineResult(runtime, await runtime.dataInitService.initState());
  resetScenarioAfterBaseline(runtime);
  await runtime.pluginStateService.init();
  await runtime.viewManagementService.loadViews();
  await runtime.viewManagementService.restoreLastView();
  recomputeAndEmitCapacity(runtime);
}

async function refreshBaseline(runtime, loadBaseline, label) {
  applyBaselineResult(runtime, await loadBaseline());
  resetScenarioAfterBaseline(runtime);
  runtime.recomputeCapacityMetrics();
  runtime.emitCapacityUpdated();
  return runtime.captureSnapshot(label);
}

async function performAutosave(runtime, { logFailures = true } = {}) {
  const scenarios = selectUnsavedWritableScenarios(
    runtime.scenarios.list(),
    (scenario) => runtime.scenarioEventService.isScenarioUnsaved(scenario)
  );
  return Promise.all(
    scenarios.map(async (scenario) => {
      const result = await runtime._dataService.saveScenario(scenario);
      const ok = !!result?.ok;
      const errorMessage = result?.error?.message || 'unknown';
      if (!ok && logFailures) console.warn('Autosave scenario failed', scenario.id, errorMessage);
      return { scenarioId: scenario.id, ok, errorMessage };
    })
  );
}

function handleAutosaveTick(runtime) {
  Promise.resolve(performAutosave(runtime)).catch((error) => {
    console.warn('Autosave tick failed', error?.message || error);
  });
}

function recomputeCapacityAndEmit(runtime, changedFeatureIds = null, { onlyIfCalculated = false } = {}) {
  const calculated = runtime.recomputeCapacityMetrics(changedFeatureIds);
  if (!onlyIfCalculated || calculated) {
    runtime.emitCapacityUpdated();
  }
  return calculated;
}

function applySelectionMutation(runtime, mutate, event, items) {
  if (!mutate()) return false;
  runtime._bus.emit(event, items);
  recomputeCapacityAndEmit(runtime);
  runtime.emitFeatureUpdated();
  return true;
}

function applyStateFilterMutation(runtime, mutate) {
  mutate();
  recomputeCapacityAndEmit(runtime);
}

function createViewStatePort(runtime) {
  return Object.freeze({
    get projects() {
      return runtime.projects;
    },
    get teams() {
      return runtime.teams;
    },
    get availableFeatureStates() {
      return runtime.availableFeatureStates;
    },
    get selectedFeatureStates() {
      return runtime.selectedFeatureStates;
    },
    get taskFilterService() {
      return runtime.taskFilterService;
    },
    get pluginStateService() {
      return runtime.pluginStateService;
    },
    setProjectsSelectedBulk: (selections) => runtime.setProjectsSelectedBulk(selections),
    setTeamsSelectedBulk: (selections) => runtime.setTeamsSelectedBulk(selections),
    setSelectedStates: (states) => runtime.setSelectedStates(states),
    setExpansionState: (options) => runtime.setExpansionState(options),
    applyViewSelectionRestore: (payload) => runtime.applyViewSelectionRestore(payload),
    applyViewOptionsRestore: (payload) => runtime.applyViewOptionsRestore(payload),
    applyViewPluginStateRestore: (payload) => runtime.applyViewPluginStateRestore(payload),
    planViewRestoreUiEffects: (payload) => runtime.planViewRestoreUiEffects(payload),
  });
}

class PlannerRuntime {
  constructor({ eventBus, adapters, dataService, store = null }) {
    if (!eventBus) throw new TypeError('Planner runtime requires an event bus');

    this._bus = eventBus;
    this._dataService = dataService;
    this._store = store;
    this._adapters = {
      viewLayout: { ...DEFAULT_ADAPTERS.viewLayout, ...(adapters?.viewLayout || {}) },
      viewManagement: {
        ...DEFAULT_ADAPTERS.viewManagement,
        ...(adapters?.viewManagement || {}),
      },
    };
    this._snapshot = null;
    this._bindings = Object.freeze({});
    this._initialized = false;
    this._initCompleted = new Promise((resolve) => {
      this._resolveInitCompleted = resolve;
    });

    this.baselineProjects = [];
    this.baselineTeams = [];
    this.baselineFeatures = [];
    this.capacityDates = [];
    this.teamDailyCapacity = [];
    this.teamDailyCapacityMap = [];
    this.projectDailyCapacityRaw = [];
    this.projectDailyCapacityMap = [];
    this.projectDailyCapacity = [];
    this.totalOrgDailyCapacity = [];
    this.totalOrgDailyPerTeamAvg = [];
    this._expansionState = {
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    };
    this._sidebarDisabled = {};

    this.baselineStore = new BaselineStore();
    this.capacityCalculator = new CapacityCalculator();
    this.capacityCoordinator = new CapacityCoordinator(this.capacityCalculator);
    this.viewService = new ViewService(this._bus, this._adapters.viewLayout);
    bindMethodDelegates(this, this.viewService, [
      'setTimelineScale',
      'setTypeVisibility',
      'isTypeVisible',
      'setDisplayMode',
      'setCondensedCards',
      'setShowDependencies',
      'setShowUnplannedWork',
      'setShowUnallocatedCards',
      'setShowOnlyProjectHierarchy',
      'setCapacityViewMode',
      'setFeatureSortMode',
      'setHighlightFeatureRelationMode',
    ]);
    this.taskFilterService = new TaskFilterService(this._bus);
    this.colorService = new ColorService(this._dataService);
    this.configService = new ConfigService(this._bus, this._dataService);
    this.stateFilterService = new StateFilterService(this._bus);
    this.featureStateService = new FeatureStateService();
    this.projectTeamService = new ProjectTeamService(this._bus);
    this.dataInitService = new DataInitService(
      this._bus,
      this._dataService,
      this.baselineStore,
      this.projectTeamService,
      this.stateFilterService,
      this.featureStateService,
      this.colorService
    );
    this.scenarioManager = new ScenarioManager(this._bus, this.baselineStore, {
      captureCurrentFilters: () => this.captureCurrentFilters(),
      captureCurrentView: () => this.captureCurrentView(),
    });
    this.scenarioEventService = new ScenarioEventService(
      this._bus,
      this.scenarioManager,
      this.viewService
    );
    this.pluginStateService = new PluginStateService(this._bus, this._dataService);
    this.viewManagementService = new ViewManagementService(
      this._bus,
      createViewStatePort(this),
      this.viewService,
      this._adapters.viewManagement
    );
    this.scenarioGroupService = new ScenarioGroupService({
      bus: this._bus,
      getActiveScenario: () => this.getActiveScenario(),
      getActiveWritableScenario: () => this.getActiveWritableScenario(),
      markChanged: () => this.markActiveScenarioChanged(),
    });

    const FeatureServiceImplementation =
      featureFlags.USE_QUEUED_FEATURE_SERVICE ? QueuedFeatureService : FeatureService;
    this.featureService = new FeatureServiceImplementation(this.baselineStore, () =>
      this.getActiveScenario()
    );
    this.featureService.setProjectTeamService(this.projectTeamService);
    Object.assign(this, {
      setProjectSelected: (id, selected) =>
        applySelectionMutation(
          this,
          () => this.projectTeamService.setProjectSelected(id, selected),
          ProjectEvents.CHANGED,
          this.projects
        ),
      setTeamSelected: (id, selected) =>
        applySelectionMutation(
          this,
          () => this.projectTeamService.setTeamSelected(id, selected),
          TeamEvents.CHANGED,
          this.teams
        ),
      setProjectsSelectedBulk: (selections) =>
        applySelectionMutation(
          this,
          () => this.projectTeamService.setProjectsSelectedBulk(selections),
          ProjectEvents.CHANGED,
          this.projects
        ),
      setTeamsSelectedBulk: (selections) =>
        applySelectionMutation(
          this,
          () => this.projectTeamService.setTeamsSelectedBulk(selections),
          TeamEvents.CHANGED,
          this.teams
        ),
      setSelectedStates: (states) =>
        applyStateFilterMutation(this, () => this.stateFilterService.setSelectedStates(states)),
      setAvailableFeatureStates: (states) => this.stateFilterService.setAvailableStates(states),
      setSelectedTaskTypes: (types) => {
        const selectedTaskTypes = Array.isArray(types) ? types.filter(Boolean) : [];
        this._bus.emit(FilterEvents.CHANGED, { selectedTaskTypes });
      },
      setAllStatesSelected: (selected) =>
        applyStateFilterMutation(this, () => this.stateFilterService.setAllStatesSelected(selected)),
      toggleStateSelected: (stateName) =>
        applyStateFilterMutation(this, () => this.stateFilterService.toggleStateSelected(stateName)),
      setStateFilter: (stateName) =>
        applyStateFilterMutation(this, () => this.stateFilterService.setStateFilter(stateName)),
      updateFeatureDates: (updates) => {
        const count = this.featureService.updateFeatureDates(updates);
        if (count && this.getActiveScenario()) {
          recomputeCapacityAndEmit(this);
        }
        return count;
      },
      updateFeatureField: (id, field, value) => {
        const updated = this.featureService.updateFeatureField(id, field, value);
        if (!updated) return false;
        if (field === 'start' || field === 'end' || field === 'capacity') {
          recomputeCapacityAndEmit(this, [id]);
        }
        this.scenarioEventService.emitScenarioUpdated(this.activeScenarioId, {
          type: 'field',
          id,
          field,
        });
        return true;
      },
      updateFeatureRelations: (id, relations) => {
        const updated = this.featureService.updateFeatureRelations(id, relations);
        if (updated) {
          this.scenarioEventService.emitScenarioUpdated(this.activeScenarioId, {
            type: 'relations',
            id,
          });
        }
        return updated;
      },
      revertFeature: (id) => {
        const reverted = this.featureService.revertFeature(id);
        if (!reverted) return false;
        recomputeCapacityAndEmit(this, [id]);
        this.scenarioEventService.emitScenarioUpdated(this.activeScenarioId, { type: 'revert', id });
        return true;
      },
      activateScenario: (id) => {
        if (this.activeScenarioId === id) return;
        this.scenarioManager.activateScenario(id);
        this.scenarioEventService.setActiveScenarioId(this.scenarioManager.activeScenarioId);
        this.scenarioEventService.emitScenarioActivated();
        recomputeCapacityAndEmit(this);
        this.emitFeatureUpdated();
        this._bus.emit(GroupEvents.CHANGED, { op: 'scenarioSwitched' });
      },
      setScenarioOverride: (featureId, start, end) => {
        this.scenarioManager.setScenarioOverride(featureId, start, end);
        if (this.activeScenarioId !== 'baseline') {
          this.scenarioEventService.emitScenarioUpdated(this.activeScenarioId, {
            type: 'override',
            featureId,
          });
        }
        recomputeCapacityAndEmit(this, [featureId]);
        this.emitFeatureUpdated([featureId]);
      },
    });
    bindMethodDelegates(this, this.featureService, [
      'getEffectiveFeatures',
      'getEffectiveFeatureById',
      'getFeatureTitleById',
      'allCountsForProject',
      'allCountsForTeam',
    ]);
    bindMethodDelegates(this, this.scenarioEventService, ['isScenarioUnsaved']);
    bindMethodDelegates(this, this.featureStateService, ['compareFeatureStates']);
    bindMethodDelegates(this, this.projectTeamService, [
      'computeFeatureOrgLoad',
      'captureCurrentFilters',
    ]);
    bindMethodDelegates(this, this.viewService, ['captureCurrentView']);
    this.scenarios = createScenarioPort(this);
    this.views = createViewPort(this);
    this.groups = createGroupPort(this);
    this._dataPorts = createDataPorts(this);
    this.events = this._dataPorts.events;
    this.config = this._dataPorts.config;
    this.plugins = this._dataPorts.plugins;
    this.cost = this._dataPorts.cost;
    this.markers = this._dataPorts.markers;
    this.history = this._dataPorts.history;
    this.server = this._dataPorts.server;

    this._unsubscribeScenariosData = this._bus.on(DataEvents.SCENARIOS_DATA, () => {
      const activeScenario = this.scenarioEventService.getScenarioById(this.activeScenarioId);
      if (
        (activeScenario?.scenarioGroups || []).length > 0 ||
        Object.keys(activeScenario?.groupOverrides || {}).length > 0
      ) {
        this._bus.emit(GroupEvents.CHANGED, { op: 'restored' });
      }
    });
    this.configService.setupAutosave(
      this.configService.autosaveIntervalMin,
      () => handleAutosaveTick(this),
      true
    );
  }

  bind(bindings = {}) {
    this._bindings = Object.freeze({ ...this._bindings, ...bindings });
    return this;
  }

  setEnvironmentAdapters(adapters = {}) {
    if (adapters.viewLayout) {
      this._adapters.viewLayout = {
        ...this._adapters.viewLayout,
        ...adapters.viewLayout,
      };
      this.viewService.setLayoutAdapter(this._adapters.viewLayout);
    }
    if (adapters.viewManagement) {
      this._adapters.viewManagement = {
        ...this._adapters.viewManagement,
        ...adapters.viewManagement,
      };
      this.viewManagementService.setEnvironment(this._adapters.viewManagement);
    }
  }

  get initialized() {
    return this._initialized;
  }

  get initCompleted() {
    return this._initCompleted;
  }

  get snapshot() {
    return this._snapshot;
  }

  get projects() {
    return this.projectTeamService.getProjects();
  }

  get teams() {
    return this.projectTeamService.getTeams();
  }

  get iterations() {
    return this.dataInitService.iterationsByProject || {};
  }

  get baselineFeatureById() {
    return this.dataInitService.baselineFeatureById;
  }

  get childrenByParent() {
    return this.dataInitService.getChildrenByParentMap();
  }

  get availableTaskTypes() {
    return selectAvailableTaskTypes(this.baselineFeatures);
  }

  get taskTypeHierarchy() {
    return selectTaskTypeHierarchy(this.baselineProjects);
  }

  get availableTaskTypesOrdered() {
    return selectOrderedTaskTypes(this.availableTaskTypes, this.taskTypeHierarchy);
  }

  get availableFeatureStates() {
    return this.stateFilterService.availableFeatureStates;
  }

  get selectedFeatureStateFilter() {
    return this.stateFilterService.selectedFeatureStateFilter;
  }

  get selectedFeatureStates() {
    return this.stateFilterService.getSelectedStates();
  }

  get activeScenarioId() {
    return this.scenarioEventService.getActiveScenarioId();
  }

  set activeScenarioId(id) {
    this.scenarioEventService.setActiveScenarioId(id);
  }

  get timelineScale() {
    return this.viewService.timelineScale;
  }

  get displayMode() {
    return this.viewService.displayMode;
  }

  get condensedCards() {
    return this.viewService.condensedCards;
  }

  get packedMode() {
    return this.viewService.packedMode;
  }

  get hiddenTypes() {
    return this.viewService.hiddenTypes;
  }

  get showDependencies() {
    return this.viewService.showDependencies;
  }

  get showUnplannedWork() {
    return this.viewService.showUnplannedWork;
  }

  get showUnallocatedCards() {
    return this.viewService.showUnassignedCards;
  }

  get showOnlyProjectHierarchy() {
    return this.viewService.showOnlyProjectHierarchy;
  }

  get capacityViewMode() {
    return this.viewService.capacityViewMode;
  }

  get featureSortMode() {
    return this.viewService.featureSortMode;
  }

  get highlightFeatureRelationMode() {
    return this.viewService.highlightFeatureRelationMode;
  }

  get expansionState() {
    return this._expansionState;
  }

  get savedViews() {
    return this.viewManagementService.getViews();
  }

  get activeViewId() {
    return this.viewManagementService.getActiveViewId();
  }

  async initialize() {
    await this._dataService.init();
    await initializeBaseline(this);
    this._initialized = true;
    const snapshot = this.captureSnapshot('runtime.initialize');
    this._resolveInitCompleted(true);
    return snapshot;
  }

  async refreshBaseline() {
    return refreshBaseline(
      this,
      () => this.dataInitService.refreshBaseline(),
      'runtime.refreshBaseline'
    );
  }

  async invalidateAndRefreshBaseline() {
    return refreshBaseline(
      this,
      () => this.dataInitService.invalidateAndRefreshBaseline(),
      'runtime.invalidateAndRefreshBaseline'
    );
  }

  captureSnapshot(label = 'runtime.snapshot') {
    const snapshot = buildRuntimeSnapshot(this);
    this._snapshot = snapshot;
    this._publishSnapshot(label, snapshot);
    return snapshot;
  }

  _publishSnapshot(label, snapshot) {
    if (!this._store?.update) return;
    publishRuntimeSnapshot(this._store, snapshot, label);
  }

  getFeatureStateColor(stateName) {
    return this.colorService.getFeatureStateColor(stateName);
  }

  getFeatureStateColors() {
    return this.colorService.getFeatureStateColors(this.availableFeatureStates);
  }

  getProjectColor(projectId) {
    return this.colorService.getProjectColor(projectId, this.projects, this.baselineProjects);
  }

  getTeamColor(teamId) {
    return this.colorService.teamColors[teamId] || this.colorService.getProjectColor(teamId, this.teams);
  }

  getIterationsForProject(projectId) {
    return selectIterationsForProject(this.iterations, projectId);
  }

  getTypeLevel(type) {
    return selectTaskTypeLevel(this.taskTypeHierarchy, type);
  }

  getTypeDisplayName(type) {
    return selectTaskTypeDisplayName(this.taskTypeHierarchy, type);
  }

  getExpandedFeatureIds() {
    return selectExpandedFeatureIds({
      projects: this.projects,
      teams: this.teams,
      features: this.getEffectiveFeatures(),
      childrenByParent: this.childrenByParent,
      expansion: {
        parentChild: this._expansionState.expandParentChild,
        relations: this._expansionState.expandRelations,
        teamAllocated: this._expansionState.expandTeamAllocated,
      },
    });
  }

  getEffectiveSelectedProjectIds() {
    const features = selectTeamAllocationExpansionFeatures({
      features: this.getEffectiveFeatures(),
      selectedTeamIds: selectSelectedIds(this.teams),
      expandTeamAllocated: this._expansionState.expandTeamAllocated,
    });
    return selectEffectiveSelectedProjectIds({
      projects: this.projects,
      teams: this.teams,
      features,
      expandTeamAllocated: this._expansionState.expandTeamAllocated,
    });
  }

  getActiveScenario() {
    return selectActiveScenario(this.scenarios.list(), this.activeScenarioId);
  }

  getActiveWritableScenario() {
    return selectActiveWritableScenario(this.scenarios.list(), this.activeScenarioId);
  }

  getScenarios() {
    return this.scenarios.list();
  }

  getActiveView() {
    return this.views.getActiveData();
  }

  async initColors() {
    await this.colorService.initColors(this.projects, this.teams);
  }

  initDefaultScenario() {
    this.scenarioEventService.initDefaultScenario(() => this.captureCurrentFilters());
  }

  getSidebarDisabledElements() {
    return this._sidebarDisabled;
  }

  setSidebarDisabledElements(controls) {
    this._sidebarDisabled = controls || {};
    this._bus.emit(FilterEvents.CHANGED, { disabledSidebar: this._sidebarDisabled });
  }

  clearSidebarDisabledElements() {
    this.setSidebarDisabledElements({});
  }

  setExpansionState(options = {}) {
    const previous = this._expansionState.expandTeamAllocated;
    if (options.expandParentChild !== undefined) {
      this._expansionState.expandParentChild = !!options.expandParentChild;
    }
    if (options.expandRelations !== undefined) {
      this._expansionState.expandRelations = !!options.expandRelations;
    }
    if (options.expandTeamAllocated !== undefined) {
      this._expansionState.expandTeamAllocated = !!options.expandTeamAllocated;
    }
    if (previous !== this._expansionState.expandTeamAllocated) {
      recomputeCapacityAndEmit(this, null, { onlyIfCalculated: true });
    }
  }

  applyViewSelectionRestore(payload = {}) {
    if (payload.projectSelections) this.setProjectsSelectedBulk(payload.projectSelections);
    if (payload.teamSelections) this.setTeamsSelectedBulk(payload.teamSelections);
    if (Array.isArray(payload.selectedStates)) this.setSelectedStates(payload.selectedStates);
    if (payload.resetTaskFilters) this.taskFilterService.resetFilters();
    else if (payload.taskFilters) this.taskFilterService.restoreFilters(payload.taskFilters);
  }

  planViewRestoreUiEffects(payload = {}) {
    return planViewRestoreUiEffects(payload);
  }

  applyViewOptionsRestore(payload = {}) {
    if (payload.viewOptions) this.viewService.restoreView(payload.viewOptions);
    if (payload.graphType) this.setCapacityViewMode(payload.graphType);
    if (Array.isArray(payload.selectedTaskTypes)) {
      this._bus.emit(FilterEvents.CHANGED, { selectedTaskTypes: payload.selectedTaskTypes });
    }
    if (payload.expansion) {
      this.setExpansionState(payload.expansion);
      if (payload.emitExpansionFilterChange) {
        this._bus.emit(FilterEvents.CHANGED, {
          expansion: {
            parentChild: !!payload.expansion.expandParentChild,
            relations: !!payload.expansion.expandRelations,
            teamAllocated: !!payload.expansion.expandTeamAllocated,
          },
        });
      }
    }
  }

  async applyViewPluginStateRestore(payload = {}) {
    await this.pluginStateService.restoreFromView(payload.pluginState || {});
    return true;
  }

  cloneScenario(sourceId, name) {
    const scenario = this.scenarioManager.cloneScenario(sourceId, name);
    this.scenarioEventService.syncScenariosFromManager();
    this.scenarioEventService.emitScenarioList();
    return scenario;
  }

  renameScenario(id, name) {
    this.scenarioManager.renameScenario(id, name);
    this.scenarioEventService.emitScenarioUpdated(id, { type: 'rename', name });
  }

  deleteScenario(id) {
    const wasActive = id === this.activeScenarioId;
    this.scenarioManager.deleteScenario(id);
    this.scenarioEventService.setActiveScenarioId(this.scenarioManager.activeScenarioId);
    this.scenarioEventService.syncScenariosFromManager();
    this.scenarioEventService.emitScenarioUpdated(id, { type: 'delete' });
    if (wasActive) this.scenarioEventService.emitScenarioActivated();
    this.emitFeatureUpdated();
  }

  async saveScenario(id) {
    const scenario = this.scenarioEventService.getScenarioById(id);
    if (!scenario) return;
    const result = await this._dataService.saveScenario(selectScenarioSavePayload(scenario));
    if (!result?.ok) throw new Error(result?.error?.message || 'Failed to save scenario');
    this.scenarioEventService.markScenarioSaved(id);
    this.scenarioEventService.emitScenarioUpdated(id, { type: 'saved' });
  }

  markActiveScenarioChanged() {
    const activeScenario = this.getActiveWritableScenario();
    if (activeScenario) activeScenario.isChanged = true;
    this.scenarioEventService.emitScenarioList();
  }

  clearPendingGroupChanges() {
    this.scenarioGroupService.clearPendingChanges();
  }

  confirmGroupCreate(tempId, realId) {
    this.scenarioGroupService.confirmCreate(tempId, realId);
  }

  createGroupInScenario(planId, name, color = null, parentId = null) {
    return this.scenarioGroupService.create(planId, name, color, parentId);
  }

  updateGroupInScenario(groupId, fields) {
    return this.scenarioGroupService.update(groupId, fields);
  }

  deleteGroupInScenario(groupId) {
    this.scenarioGroupService.delete(groupId);
  }

  applyGroupMemberDelta(groupId, taskId, op) {
    this.scenarioGroupService.applyMemberDelta(groupId, taskId, op);
  }

  async performAutosave({ logFailures = true } = {}) {
    return performAutosave(this, { logFailures });
  }

  recomputeCapacityMetrics(changedFeatureIds = null) {
    const { result, calculated } = this.capacityCoordinator.calculate({
      features: this.getEffectiveFeatures(),
      baselineTeams: this.baselineTeams,
      baselineProjects: this.baselineProjects,
      selectedProjectIds: this.getEffectiveSelectedProjectIds(),
      allProjectIds: selectAllIds(this.projects),
      selectedTeamIds: selectSelectedIds(this.teams),
      selectedStateIds: selectSelectedStateNames(this.selectedFeatureStateFilter),
      graphOnlySelected: featureFlags.GRAPH_ONLY_SELECTED_PLANS,
      requireProjectSelection: this.projects.length > 0,
      requireTeamSelection: this.teams.length > 0,
      stateFilterActive: !!this.selectedFeatureStateFilter,
      childrenByParent: this.childrenByParent,
      changedFeatureIds,
    });
    this.capacityDates = result.dates;
    this.teamDailyCapacity = result.teamDailyCapacity;
    this.teamDailyCapacityMap = result.teamDailyCapacityMap;
    this.projectDailyCapacityRaw = result.projectDailyCapacityRaw;
    this.projectDailyCapacity = result.projectDailyCapacity;
    this.projectDailyCapacityMap = result.projectDailyCapacityMap;
    this.totalOrgDailyCapacity = result.totalOrgDailyCapacity;
    this.totalOrgDailyPerTeamAvg = result.totalOrgDailyPerTeamAvg;
    return calculated;
  }

  emitCapacityUpdated() {
    this._bus.emit(
      CapacityEvents.UPDATED,
      selectCapacityEventPayload({
        dates: this.capacityDates,
        teamDaily: this.teamDailyCapacity,
        teamDailyMap: this.teamDailyCapacityMap,
        projectDailyRaw: this.projectDailyCapacityRaw,
        projectDaily: this.projectDailyCapacity,
        projectDailyMap: this.projectDailyCapacityMap,
        organizationDaily: this.totalOrgDailyCapacity,
        organizationDailyPerTeamAverage: this.totalOrgDailyPerTeamAvg,
      })
    );
  }

  emitFeatureUpdated(ids = []) {
    this._bus.emit(FeatureEvents.UPDATED, { ids: Array.isArray(ids) ? ids.filter(Boolean) : [] });
  }

  async destroy() {
    this._unsubscribeScenariosData?.();
    this.configService.destroy();
  }
}

/**
 * Construct one explicit Planner runtime and its State-era collaborators.
 *
 * The factory intentionally has no singleton export. Composition roots can
 * create isolated runtime instances for the browser, tests, or future hosts.
 *
 * @param {{eventBus: object, adapters?: object, dataService?: object, store?: object}} options
 * @returns {{runtime: object, bind: (bindings: object) => object}}
 */
export function createPlannerRuntimeServices({
  eventBus,
  adapters = {},
  dataService = defaultDataService,
  store = null,
} = {}) {
  const runtime = new PlannerRuntime({ eventBus, adapters, dataService, store });
  return Object.freeze({
    runtime,
    bind: (bindings) => runtime.bind(bindings),
  });
}