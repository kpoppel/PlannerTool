import { featureFlags } from '../config.js';
import {
  CapacityEvents,
  DataEvents,
  FeatureEvents,
  FilterEvents,
  GroupEvents,
  ProjectEvents,
  ScenarioEvents,
  StateFilterEvents,
  TeamEvents,
  ViewEvents,
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
import { ScenarioGroupService } from '../services/ScenarioGroupService.js';
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
import { startPerfProbe, endPerfProbe } from '../services/perfProbe.js';

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

const RUNTIME_PHASES = Object.freeze({
  BOOTING: 'booting',
  RESTORING_VIEW: 'restoringView',
  READY: 'ready',
});

function cloneJson(value) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}

function buildScenarioDefaultName(items = [], date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  let maxN = 0;
  const re = /^\d{2}-\d{2} Scenario (\d+)$/i;
  for (const item of items) {
    const match = re.exec(item?.name || '');
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > maxN) maxN = value;
  }
  return `${mm}-${dd} Scenario ${maxN + 1}`;
}

function ensureUniqueScenarioName(items = [], baseName, excludeId = null) {
  let candidate = String(baseName || '').trim();
  let counter = 2;
  while (
    items.some(
      (item) => item?.id !== excludeId && String(item?.name || '').toLowerCase() === candidate.toLowerCase()
    )
  ) {
    candidate = `${baseName} ${counter++}`;
  }
  return candidate;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function selectedIdsFromSelections(selections) {
  return Object.entries(asObject(selections))
    .filter(([, selected]) => !!selected)
    .map(([id]) => id);
}

function normalizeViewOptionsForStore(rawViewOptions) {
  const viewOptions = asObject(rawViewOptions);
  const updates = {};

  if (viewOptions.displayMode !== undefined) {
    const normalized =
      viewOptions.displayMode === 'compact' || viewOptions.displayMode === 'packed' ?
        viewOptions.displayMode
      : 'normal';
    updates.displayMode = normalized;
    if (viewOptions.condensedCards === undefined) {
      updates.condensedCards = normalized !== 'normal';
    }
  }
  if (viewOptions.condensedCards !== undefined) {
    const normalized = !!viewOptions.condensedCards;
    updates.condensedCards = normalized;
    if (viewOptions.displayMode === undefined) {
      updates.displayMode = normalized ? 'compact' : 'normal';
    }
  }
  if (viewOptions.showDependencies !== undefined) updates.showDependencies = !!viewOptions.showDependencies;
  if (viewOptions.showUnplannedWork !== undefined) updates.showUnplannedWork = !!viewOptions.showUnplannedWork;
  if (viewOptions.showUnallocatedCards !== undefined) {
    updates.showUnallocatedCards = !!viewOptions.showUnallocatedCards;
  } else if (viewOptions.showUnassignedCards !== undefined) {
    updates.showUnallocatedCards = !!viewOptions.showUnassignedCards;
  }
  if (viewOptions.showOnlyProjectHierarchy !== undefined) {
    updates.showOnlyProjectHierarchy = !!viewOptions.showOnlyProjectHierarchy;
  }
  if (viewOptions.capacityViewMode === 'team' || viewOptions.capacityViewMode === 'project') {
    updates.capacityViewMode = viewOptions.capacityViewMode;
  }
  if (viewOptions.featureSortMode === 'rank' || viewOptions.featureSortMode === 'date') {
    updates.featureSortMode = viewOptions.featureSortMode;
  }
  if (viewOptions.highlightFeatureRelationMode !== undefined) {
    updates.highlightFeatureRelationMode = !!viewOptions.highlightFeatureRelationMode;
  }

  return updates;
}

function defaultTaskFilters() {
  return {
    schedule: { planned: true, unplanned: true },
    allocation: { allocated: true, unallocated: true },
    hierarchy: { hasParent: true, noParent: true },
    relations: { hasLinks: true, noLinks: true },
  };
}

function mergeRestoredTaskFilters(savedFilters) {
  const merged = defaultTaskFilters();
  const source = asObject(savedFilters);
  for (const dimension of Object.keys(merged)) {
    const sourceDimension = asObject(source[dimension]);
    for (const option of Object.keys(merged[dimension])) {
      if (sourceDimension[option] !== undefined) {
        merged[dimension][option] = !!sourceDimension[option];
      }
    }
  }
  return merged;
}

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

function shallowEqualSavedViews(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] || {};
    const r = right[index] || {};
    if ((l.id || null) !== (r.id || null)) return false;
    if ((l.name || '') !== (r.name || '')) return false;
    if (!!l.readonly !== !!r.readonly) return false;
  }
  return true;
}

function arrayShallowEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function deepEqualJsonLike(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqualJsonLike(left[index], right[index])) return false;
    }
    return true;
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!deepEqualJsonLike(left[key], right[key])) return false;
  }
  return true;
}

function applyBaselineResult(runtime, { baselineProjects, baselineTeams, baselineFeatures }) {
  const baselineSync = runtime.replaceBaselineAndEnsureScenario({
    projects: baselineProjects,
    teams: baselineTeams,
    features: baselineFeatures,
    iterationsByProject: runtime.iterations,
  });
  runtime.featureService.setChildrenByParent(runtime.childrenByParent);
  return baselineSync;
}

function resetScenarioAfterBaseline(runtime, scenarioSync = null) {
  const effectiveSync = scenarioSync || runtime.ensureBaselineScenario();
  if (effectiveSync?.listChanged) runtime.emitScenarioList();
  if (effectiveSync?.activeChanged) runtime.emitScenarioActivated();
}

function recomputeAndEmitCapacity(runtime) {
  if (runtime.recomputeCapacityMetrics()) runtime.emitCapacityUpdated();
}

function scheduleInitialCapacityRecompute(runtime) {
  const run = () => {
    try {
      recomputeAndEmitCapacity(runtime);
    } catch (error) {
      console.warn('Initial capacity recompute failed', error);
    }
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
    return;
  }
  setTimeout(run, 0);
}

async function initializeBaseline(runtime) {
  const scenarioSync = applyBaselineResult(runtime, await runtime.dataInitService.initState());
  resetScenarioAfterBaseline(runtime, scenarioSync);
  runtime.featureService.setChildrenByParent(runtime.childrenByParent);
  await runtime.pluginStateService.init();
  await runtime.viewManagementService.loadViews({ deferStateSync: true });
  runtime._setRuntimePhase(RUNTIME_PHASES.RESTORING_VIEW);
  try {
    await runtime.viewManagementService.restoreLastView({ startup: true });
  } finally {
    runtime._setRuntimePhase(RUNTIME_PHASES.BOOTING);
  }
  if (!runtime.consumeViewRestoreCapacityRecomputeFlag() && !runtime.consumeStartupCapacityRecomputeFlag()) {
    scheduleInitialCapacityRecompute(runtime);
  }
}

async function refreshBaseline(runtime, loadBaseline, label) {
  const scenarioSync = applyBaselineResult(runtime, await loadBaseline());
  resetScenarioAfterBaseline(runtime, scenarioSync);
  runtime.recomputeCapacityMetrics();
  runtime.emitCapacityUpdated();
  return runtime.captureSnapshot(label);
}

async function performAutosave(runtime, { logFailures = true } = {}) {
  const scenarios = selectUnsavedWritableScenarios(
    runtime.getScenarios(),
    (scenario) => runtime.isScenarioUnsaved(scenario)
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

function applySelectionEffects(runtime, event, items) {
  if (runtime._isViewRestoreBatchActive()) {
    runtime._queueViewRestoreSelectionEvent(event);
    runtime._queueViewRestoreCapacityRecompute();
    runtime._queueViewRestoreFeatureUpdate();
    return;
  }
  runtime._bus.emit(event, items);
  recomputeCapacityAndEmit(runtime);
  runtime.emitFeatureUpdated();
}

function applyStateFilterMutation(runtime, mutate) {
  mutate();
  if (runtime._isViewRestoreBatchActive()) {
    runtime._queueViewRestoreCapacityRecompute();
    return;
  }
  recomputeCapacityAndEmit(runtime);
}

function createViewStatePort(runtime) {
  return Object.freeze({
    replaceViewState: ({ saved, activeId } = {}) => runtime.replaceViewState({ saved, activeId }),
    get savedViews() {
      return runtime.savedViews;
    },
    get activeViewId() {
      return runtime.activeViewId;
    },
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
    setProjectsSelectedBulk: (selections) => runtime._bindings.commands.setProjectsSelectedBulk(selections),
    setTeamsSelectedBulk: (selections) => runtime._bindings.commands.setTeamsSelectedBulk(selections),
    setSelectedStates: (states) => runtime.setSelectedStates(states),
    setExpansionState: (options) => runtime._bindings.commands.setExpansionState(options),
    applyViewRestoreTransaction: (payload) => runtime.applyViewRestoreTransaction(payload),
    applyViewSelectionRestore: (payload) => runtime.applyViewSelectionRestore(payload),
    applyViewOptionsRestore: (payload) => runtime.applyViewOptionsRestore(payload),
    applyViewPluginStateRestore: (payload) => runtime.applyViewPluginStateRestore(payload),
    planViewRestoreUiEffects: (payload) => runtime.planViewRestoreUiEffects(payload),
    beginViewRestoreBatch: (options = {}) => runtime.beginViewRestoreBatch(options),
    endViewRestoreBatch: () => runtime.endViewRestoreBatch(),
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
    this._initializePromise = null;
    this._runtimePhase = RUNTIME_PHASES.BOOTING;
    this._initCompleted = new Promise((resolve) => {
      this._resolveInitCompleted = resolve;
    });

    this._sidebarDisabled = {};
    this._viewRestoreBatchDepth = 0;
    this._viewRestoreNeedsCapacityRecompute = false;
    this._viewRestoreNeedsFeatureUpdate = false;
    this._viewRestoreNeedsProjectEvent = false;
    this._viewRestoreNeedsTeamEvent = false;
    this._viewRestoreNeedsViewEvents = false;
    this._viewRestoreFilterPayload = null;
    this._viewRestorePerformedCapacityRecompute = false;
    this._startupCapacityRecomputed = false;

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
    this.taskFilterService = new TaskFilterService(this._bus, {
      store: this._store,
      events: {
        emitFilterChanged: (bus, payload) => {
          if (this._isViewRestoreBatchActive()) {
            this._queueViewRestoreFilterPayload(payload);
            return;
          }
          bus?.emit?.(FilterEvents.CHANGED, payload);
        },
        emitFeatureUpdated: (bus, payload) => {
          if (this._isViewRestoreBatchActive()) {
            this._queueViewRestoreFeatureUpdate();
            return;
          }
          bus?.emit?.(FeatureEvents.UPDATED, payload);
        },
      },
    });
    this.colorService = new ColorService(this._dataService);
    this.configService = new ConfigService(this._bus, this._dataService);
    this.stateFilterService = new StateFilterService(this._bus, {
      events: {
        emitStateFilterChanged: (bus, payload) => {
          bus?.emit?.(StateFilterEvents.CHANGED, payload);
        },
        emitFilterChanged: (bus, payload) => {
          if (this._isViewRestoreBatchActive()) {
            this._queueViewRestoreFilterPayload(payload);
            return;
          }
          bus?.emit?.(FilterEvents.CHANGED, payload);
        },
        emitFeatureUpdated: (bus, payload) => {
          if (this._isViewRestoreBatchActive()) {
            this._queueViewRestoreFeatureUpdate();
            return;
          }
          bus?.emit?.(FeatureEvents.UPDATED, payload);
        },
      },
    });
    this.featureStateService = new FeatureStateService();
    this.projectTeamService = new ProjectTeamService(this._bus);
    this.projectTeamService.setSelectionProvider({
      getProjectIds: () => this._store.getState().selection.projectIds,
      getTeamIds: () => this._store.getState().selection.teamIds,
    });
    this.dataInitService = new DataInitService(
      this._bus,
      this._dataService,
      this.baselineStore,
      this.projectTeamService,
      this.stateFilterService,
      this.featureStateService,
      this.colorService
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
      markChanged: (scenario) => this.markActiveScenarioChanged(scenario),
    });

    this.featureService = new FeatureService(this.baselineStore, () =>
      this.getActiveScenario()
    );
    this.featureService.setProjectTeamService(this.projectTeamService);
    Object.assign(this, {
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
      activateScenario: (id) => {
        this.emitScenarioActivated(id);
        recomputeCapacityAndEmit(this);
        this.emitFeatureUpdated();
        this._bus.emit(GroupEvents.CHANGED, { op: 'scenarioSwitched' });
      },
      setScenarioOverride: (featureId, start, end) => {
        const updated = this.mutateActiveScenario('scenario.featureOverride.command', (scenario) => {
          scenario.overrides ||= {};
          scenario.overrides[featureId] = {
            ...(scenario.overrides[featureId] || {}),
            start,
            end,
          };
          scenario.isChanged = true;
          return true;
        });
        if (updated && this.activeScenarioId !== 'baseline') {
          this.emitScenarioUpdated(this.activeScenarioId, {
            type: 'override',
            featureId,
          });
        }
        if (updated) {
          recomputeCapacityAndEmit(this, [featureId]);
          this.emitFeatureUpdated([featureId]);
        }
        return updated;
      },
    });
    bindMethodDelegates(this, this.featureService, [
      'getEffectiveFeatures',
      'getEffectiveFeatureById',
      'getFeatureTitleById',
      'allCountsForProject',
      'allCountsForTeam',
    ]);
    bindMethodDelegates(this, this.featureStateService, ['compareFeatureStates']);
    bindMethodDelegates(this, this.projectTeamService, [
      'computeFeatureOrgLoad',
      'captureCurrentFilters',
    ]);
    bindMethodDelegates(this, this.viewService, ['captureCurrentView']);
    this.scenarios = Object.freeze({
      list: () => this.getScenarios(), activate: (id) => this._bindings.commands.activateScenario(id),
      rename: (id, name) => this._bindings.commands.renameScenario(id, name), delete: (id) => this._bindings.commands.deleteScenario(id),
      save: (id) => this._bindings.commands.saveScenario(id), clone: (sourceId, name) => this._bindings.commands.cloneScenario(sourceId, name),
      getActiveId: () => this.activeScenarioId, getActive: () => this.getActiveScenario(),
    });
    this.views = Object.freeze({
      list: () => this.viewManagementService.getViews(), save: (name, viewId = null) => this.viewManagementService.saveCurrentView(name, viewId),
      rename: (viewId, name) => this.viewManagementService.renameView(viewId, name), delete: (viewId) => this.viewManagementService.deleteView(viewId),
      load: (viewId) => this.viewManagementService.loadAndApplyView(viewId), restoreLast: () => this.viewManagementService.restoreLastView(),
      getActiveId: () => this.viewManagementService.getActiveViewId(), getActiveData: () => this.viewManagementService.getActiveViewData(),
    });
    this.groups = Object.freeze({
      ...bindDataPort(this._dataService, [['list', 'listGroups', []], ['create', 'createGroup', null], ['update', 'updateGroup', null], ['delete', 'deleteGroup', false], ['publishBaseline', 'publishBaseline', { ok: false }]]),
      getPendingChanges: () => this.scenarioGroupService.getPendingChanges(), clearPendingChanges: () => this._bindings.commands.clearPendingGroupChanges(),
      confirmCreate: (tempId, realId) => this._bindings.commands.confirmGroupCreate(tempId, realId), createInScenario: (planId, name, color = null, parentId = null) => this._bindings.commands.createGroupInScenario(planId, name, color, parentId),
      updateInScenario: (groupId, fields) => this._bindings.commands.updateGroupInScenario(groupId, fields), deleteInScenario: (groupId) => this._bindings.commands.deleteGroupInScenario(groupId),
      applyMemberDelta: (groupId, taskId, op) => this._bindings.commands.applyGroupMemberDelta(groupId, taskId, op),
    });
    this.events = Object.freeze(bindDataPort(this._dataService, [['getAll', 'getEvents', []], ['getCategories', 'getEventCategories', []], ['create', 'createEvent', null], ['update', 'updateEvent', null], ['delete', 'deleteEvent', false], ['createCategory', 'createEventCategory', null], ['updateCategory', 'updateEventCategory', null], ['deleteCategory', 'deleteEventCategory', false]]));
    this.config = Object.freeze({ ...bindDataPort(this._dataService, [['getPref', 'getLocalPref', null], ['setPref', 'setLocalPref', undefined], ['saveAccountConfig', 'saveConfig', null], ['updateProjectColor', 'updateProjectColor', undefined], ['updateTeamColor', 'updateTeamColor', undefined]]) });
    this.plugins = Object.freeze(bindDataPort(this._dataService, [['getConfig', 'getPluginsConfig', null], ['getSchemas', 'getPluginsSchemas', null]]));
    this.cost = Object.freeze(bindDataPort(this._dataService, [['get', 'getCost', null], ['getTeams', 'getCostTeams', []], ['updateWorkItemCapacity', 'updateWorkItemCapacity', { ok: false }]]));
    this.markers = Object.freeze(bindDataPort(this._dataService, [['getAll', 'getMarkers', []]]));
    this.history = Object.freeze(bindDataPort(this._dataService, [['get', 'getHistory', { tasks: [] }]]));
    this.server = Object.freeze(bindDataPort(this._dataService, [['health', 'checkHealth', { status: 'error' }]]));

    this._unsubscribeScenariosChanged = this._bus.on(DataEvents.SCENARIOS_CHANGED, () => {
      this.emitScenarioList();
    });
    this._unsubscribeScenariosData = this._bus.on(DataEvents.SCENARIOS_DATA, (scenarios) => {
      this._bindings.commands.hydrateScenarioData(scenarios);
      const activeScenario = this.getActiveScenario();
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

  get runtimePhase() {
    return this._runtimePhase;
  }

  _setRuntimePhase(phase) {
    if (Object.values(RUNTIME_PHASES).includes(phase)) {
      this._runtimePhase = phase;
    }
  }

  isStartupPhaseActive() {
    return this._runtimePhase !== RUNTIME_PHASES.READY;
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

  replaceBaselineState({ projects, teams, features, iterationsByProject } = {}) {
    this._store.update('baseline.replace.runtime', (draft) => {
      if (projects !== undefined) draft.baseline.projects = Array.isArray(projects) ? projects : [];
      if (teams !== undefined) draft.baseline.teams = Array.isArray(teams) ? teams : [];
      if (features !== undefined) draft.baseline.features = Array.isArray(features) ? features : [];
      if (iterationsByProject !== undefined) {
        draft.baseline.iterationsByProject =
          iterationsByProject && typeof iterationsByProject === 'object' ? iterationsByProject : {};
      }
    });
  }

  replaceBaselineAndEnsureScenario({ projects, teams, features, iterationsByProject } = {}) {
    const result = {
      listChanged: false,
      activeChanged: false,
    };
    this._store.update('baseline.ensureScenario.runtime', (draft) => {
      if (projects !== undefined) draft.baseline.projects = Array.isArray(projects) ? projects : [];
      if (teams !== undefined) draft.baseline.teams = Array.isArray(teams) ? teams : [];
      if (features !== undefined) draft.baseline.features = Array.isArray(features) ? features : [];
      if (iterationsByProject !== undefined) {
        draft.baseline.iterationsByProject =
          iterationsByProject && typeof iterationsByProject === 'object' ? iterationsByProject : {};
      }

      const existing = draft.scenarios.items.find((scenario) => scenario?.id === 'baseline');
      if (existing) {
        const hasOverrides = Object.keys(existing.overrides || {}).length > 0;
        const dirty = existing.isChanged === true;
        const writable = existing.readonly !== true;
        if (hasOverrides || dirty || writable) {
          existing.overrides = {};
          existing.isChanged = false;
          existing.readonly = true;
          result.listChanged = true;
        }
      } else {
        draft.scenarios.items = [
          {
            id: 'baseline',
            name: 'Baseline',
            overrides: {},
            filters: cloneJson(this.captureCurrentFilters()),
            view: cloneJson(this.captureCurrentView()),
            isChanged: false,
            readonly: true,
          },
          ...draft.scenarios.items,
        ];
        result.listChanged = true;
      }
      if (!draft.scenarios.activeId) {
        draft.scenarios.activeId = 'baseline';
        result.activeChanged = true;
      }
    });
    return result;
  }

  replaceCapacityState(nextCapacity = {}) {
    this._store.update('capacity.recompute.runtime', (draft) => {
      draft.capacity = {
        ...(draft.capacity || {}),
        ...nextCapacity,
      };
    });
  }

  get baselineFeatures() {
    return this._store.getState().baseline.features || [];
  }

  set baselineFeatures(features) {
    this.replaceBaselineState({ features });
  }

  get baselineFeatureById() {
    return this.dataInitService.baselineFeatureById;
  }

  get childrenByParent() {
    return this.dataInitService.getChildrenByParentMap();
  }

  get availableTaskTypes() {
    return selectAvailableTaskTypes(this._store.getState().baseline.features || []);
  }

  get taskTypeHierarchy() {
    return selectTaskTypeHierarchy(this._store.getState().baseline.projects || []);
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
    return this._store.getState().scenarios.activeId || null;
  }

  set activeScenarioId(id) {
    this._store.update('scenario.active.runtime', (draft) => {
      draft.scenarios.activeId = id || null;
    });
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
    const expansion = this._store.getState().view.expansion;
    return {
      expandParentChild: !!expansion.parentChild,
      expandRelations: !!expansion.relations,
      expandTeamAllocated: !!expansion.teamAllocated,
    };
  }

  get savedViews() {
    return this._store.getState().view.saved || [];
  }

  get activeViewId() {
    return this._store.getState().view.activeId || null;
  }

  replaceViewState({ saved, activeId } = {}) {
    if (saved === undefined && activeId === undefined) return false;
    const currentView = this._store.getState().view || {};
    const nextActiveId = activeId === undefined ? undefined : activeId || null;
    if (
      (saved === undefined || shallowEqualSavedViews(currentView.saved || [], saved || [])) &&
      (nextActiveId === undefined || nextActiveId === (currentView.activeId || null))
    ) {
      return false;
    }

    this._store.update('view.replace.runtime', (draft) => {
      if (saved !== undefined) draft.view.saved = Array.isArray(saved) ? saved : [];
      if (activeId !== undefined) draft.view.activeId = activeId || null;
    });
    return true;
  }

  async initialize() {
    if (this._initialized) {
      return this._snapshot || this.captureSnapshot('runtime.initialize.cached', { publish: false });
    }
    if (this._initializePromise) return this._initializePromise;

    this._initializePromise = (async () => {
      this._setRuntimePhase(RUNTIME_PHASES.BOOTING);
      await this._dataService.init();
      await initializeBaseline(this);
      this._initialized = true;
      this._setRuntimePhase(RUNTIME_PHASES.READY);
      this._resolveInitCompleted(true);
      return this._snapshot;
    })();

    try {
      return await this._initializePromise;
    } finally {
      this._initializePromise = null;
    }
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

  captureSnapshot(label = 'runtime.snapshot', { publish = true } = {}) {
    const snapshot = buildRuntimeSnapshot(this);
    this._snapshot = snapshot;
    if (publish) this._publishSnapshot(label, snapshot);
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
    return this.colorService.getProjectColor(
      projectId,
      this.projects,
      this._store.getState().baseline.projects || []
    );
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
        parentChild: this.expansionState.expandParentChild,
        relations: this.expansionState.expandRelations,
        teamAllocated: this.expansionState.expandTeamAllocated,
      },
    });
  }

  getEffectiveSelectedProjectIds(stateOrEffectiveFeatures = null, maybeEffectiveFeatures = null) {
    const hasState = !!stateOrEffectiveFeatures && !Array.isArray(stateOrEffectiveFeatures);
    const state = hasState ? stateOrEffectiveFeatures : null;
    const sourceFeatures = hasState ? maybeEffectiveFeatures || this.getEffectiveFeatures(state) : stateOrEffectiveFeatures || this.getEffectiveFeatures();
    const projects = asArray(state?.projects || this.projects);
    const teams = asArray(state?.teams || this.teams);
    const expansion = asObject(state?.view?.expansion || this._store.getState().view?.expansion);
    const selectedTeamIds = selectSelectedIds(teams);
    const features = selectTeamAllocationExpansionFeatures({
      features: sourceFeatures,
      selectedTeamIds,
      expandTeamAllocated: !!expansion.teamAllocated,
    });
    return selectEffectiveSelectedProjectIds({
      projects,
      teams,
      features,
      expandTeamAllocated: !!expansion.teamAllocated,
    });
  }

  calculateCapacityState(state = this._store.getState(), changedFeatureIds = null, overrides = {}) {
    const snapshot = state || this._store.getState();
    const effectiveFeatures = this.getEffectiveFeatures(snapshot);
    const baseline = asObject(snapshot.baseline);
    const selectedProjectIds = this.getEffectiveSelectedProjectIds(snapshot, effectiveFeatures);
    const selectedTeamIds = selectSelectedIds(asArray(snapshot.teams || this.teams));
    const selectedStateIds =
      overrides.selectedStateIds !== undefined ?
        selectSelectedStateNames(overrides.selectedStateIds)
      : selectSelectedStateNames(snapshot.selection?.featureStateNames);
    const projects = asArray(snapshot.projects || this.projects);
    const teams = asArray(snapshot.teams || this.teams);
    const calculation = this.capacityCoordinator.calculate({
      features: effectiveFeatures,
      baselineTeams: baseline.teams || [],
      baselineProjects: baseline.projects || [],
      selectedProjectIds,
      allProjectIds: selectAllIds(projects),
      selectedTeamIds,
      selectedStateIds,
      graphOnlySelected: featureFlags.GRAPH_ONLY_SELECTED_PLANS,
      requireProjectSelection: projects.length > 0,
      requireTeamSelection: teams.length > 0,
      stateFilterActive: selectedStateIds.length > 0,
      childrenByParent: this.childrenByParent,
      changedFeatureIds,
    });
    return {
      ...calculation,
      effectiveFeatureCount: Array.isArray(effectiveFeatures) ? effectiveFeatures.length : 0,
      selectedProjectCount: selectedProjectIds.length,
      selectedTeamCount: selectedTeamIds.length,
    };
  }

  getActiveScenario() {
    return selectActiveScenario(this._store.getState().scenarios.items, this.activeScenarioId);
  }

  getActiveWritableScenario() {
    return selectActiveWritableScenario(this._store.getState().scenarios.items, this.activeScenarioId);
  }

  mutateActiveScenario(label, mutate) {
    let result = false;
    this._store.update(label, (draft) => {
      const scenario = selectActiveWritableScenario(
        draft.scenarios.items,
        draft.scenarios.activeId
      );
      if (scenario) result = mutate(scenario);
    });
    return result;
  }

  getScenarios() {
    return this._store.getState().scenarios.items || [];
  }

  getScenarioById(id) {
    return this.getScenarios().find((scenario) => scenario?.id === id);
  }

  isScenarioUnsaved(scenario) {
    return scenario?.isChanged === true;
  }

  ensureBaselineScenario() {
    const result = {
      listChanged: false,
      activeChanged: false,
    };
    const currentScenarios = this.getScenarios();
    const currentBaseline = currentScenarios.find((scenario) => scenario?.id === 'baseline');
    if (currentBaseline) {
      const hasOverrides = Object.keys(currentBaseline.overrides || {}).length > 0;
      const dirty = currentBaseline.isChanged === true;
      const writable = currentBaseline.readonly !== true;
      const activeMissing = !this.activeScenarioId;
      if (!hasOverrides && !dirty && !writable && !activeMissing) {
        return result;
      }
    }
    this._store.update('scenario.ensureBaseline.runtime', (draft) => {
      const existing = draft.scenarios.items.find((scenario) => scenario?.id === 'baseline');
      if (existing) {
        const hasOverrides = Object.keys(existing.overrides || {}).length > 0;
        const dirty = existing.isChanged === true;
        const writable = existing.readonly !== true;
        if (hasOverrides || dirty || writable) {
          existing.overrides = {};
          existing.isChanged = false;
          existing.readonly = true;
          result.listChanged = true;
        }
      } else {
        draft.scenarios.items = [
          {
            id: 'baseline',
            name: 'Baseline',
            overrides: {},
            filters: cloneJson(this.captureCurrentFilters()),
            view: cloneJson(this.captureCurrentView()),
            isChanged: false,
            readonly: true,
          },
          ...draft.scenarios.items,
        ];
        result.listChanged = true;
      }
      if (!draft.scenarios.activeId) {
        draft.scenarios.activeId = 'baseline';
        result.activeChanged = true;
      }
    });
    return result;
  }

  prepareScenarioHydration(remoteScenarios = []) {
    const currentItems = this.getScenarios();
    const readonly = currentItems.filter((scenario) => scenario?.readonly);
    const items = [...readonly];
    for (const scenario of remoteScenarios || []) {
      const merged = Object.assign(
        {
          overrides: {},
          filters: cloneJson(this.captureCurrentFilters()),
          view: cloneJson(this.captureCurrentView()),
          isChanged: false,
          readonly: false,
        },
        scenario
      );
      if (!items.some((existing) => existing.id === merged.id)) {
        items.push(merged);
      }
    }
    const activeId =
      items.find((item) => item.id === this.activeScenarioId)?.id ||
      items.find((item) => item.readonly)?.id ||
      items[0]?.id ||
      'baseline';
    return { items, activeId };
  }

  buildScenarioClone(sourceId, name) {
    const items = this.getScenarios();
    const source = items.find((scenario) => scenario?.id === sourceId && !scenario?.readonly);
    const baseName = name ? name.trim() : buildScenarioDefaultName(items);
    return {
      id: `scen_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      name: ensureUniqueScenarioName(items, baseName),
      overrides: source ? cloneJson(source.overrides) : {},
      filters: source ? cloneJson(source.filters) : cloneJson(this.captureCurrentFilters()),
      view: source ? cloneJson(source.view) : cloneJson(this.captureCurrentView()),
      isChanged: true,
      readonly: false,
    };
  }

  normalizeScenarioName(id, name) {
    return ensureUniqueScenarioName(this.getScenarios(), String(name || '').trim(), id);
  }

  emitScenarioList() {
    this._bus.emit(ScenarioEvents.LIST, {
      scenarios: this.getScenarios().map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        overridesCount: Object.keys(scenario.overrides || {}).length,
        unsaved: this.isScenarioUnsaved(scenario),
        readonly: scenario.readonly === true,
      })),
      activeScenarioId: this.activeScenarioId,
    });
  }

  emitScenarioActivated(id = this.activeScenarioId) {
    this._bus.emit(ScenarioEvents.ACTIVATED, { scenarioId: id });
  }

  emitScenarioUpdated(id, change) {
    this._bus.emit(ScenarioEvents.UPDATED, { scenarioId: id, change });
    this.emitScenarioList();
  }

  getActiveView() {
    return this.views.getActiveData();
  }

  async initColors() {
    await this.colorService.initColors(this.projects, this.teams);
  }

  initDefaultScenario() {
    this.ensureBaselineScenario();
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

  handleProjectSelectionChanged() {
    applySelectionEffects(this, ProjectEvents.CHANGED, this.projects);
  }

  handleTeamSelectionChanged() {
    applySelectionEffects(this, TeamEvents.CHANGED, this.teams);
  }

  handleExpansionChanged(previousTeamAllocation) {
    if (previousTeamAllocation !== this.expansionState.expandTeamAllocated) {
      if (this._isViewRestoreBatchActive()) {
        this._queueViewRestoreCapacityRecompute();
        return;
      }
      recomputeCapacityAndEmit(this, null, { onlyIfCalculated: true });
    }
  }

  beginViewRestoreBatch(options = {}) {
    const startup = !!options.startup;
    if (!startup || !this.isStartupPhaseActive()) {
      return false;
    }
    this._viewRestoreBatchDepth += 1;
    return true;
  }

  endViewRestoreBatch() {
    if (this._viewRestoreBatchDepth <= 0) return false;
    this._viewRestoreBatchDepth = Math.max(0, this._viewRestoreBatchDepth - 1);
    if (this._viewRestoreBatchDepth > 0) return true;

    const needsCapacity = this._viewRestoreNeedsCapacityRecompute;
    const needsFeatureUpdate = this._viewRestoreNeedsFeatureUpdate;
    const needsProjectEvent = this._viewRestoreNeedsProjectEvent;
    const needsTeamEvent = this._viewRestoreNeedsTeamEvent;
    const needsViewEvents = this._viewRestoreNeedsViewEvents;
    const filterPayload = this._viewRestoreFilterPayload;
    this._viewRestoreNeedsCapacityRecompute = false;
    this._viewRestoreNeedsFeatureUpdate = false;
    this._viewRestoreNeedsProjectEvent = false;
    this._viewRestoreNeedsTeamEvent = false;
    this._viewRestoreNeedsViewEvents = false;
    this._viewRestoreFilterPayload = null;

    if (needsProjectEvent) {
      this._bus.emit(ProjectEvents.CHANGED, this.projects);
    }
    if (needsTeamEvent) {
      this._bus.emit(TeamEvents.CHANGED, this.teams);
    }

    if (needsViewEvents) {
      this._queueViewRestoreFilterPayload({
        hiddenTypes: Array.from(this.viewService.hiddenTypes),
        showUnassignedCards: this.viewService.showUnassignedCards,
        showUnplannedWork: this.viewService.showUnplannedWork,
        showOnlyProjectHierarchy: this.viewService.showOnlyProjectHierarchy,
      });
      this._bus.emit(ViewEvents.DEPENDENCIES, this.viewService.showDependencies);
      this._bus.emit(ViewEvents.CONDENSED, this.viewService.condensedCards);
      this._bus.emit(ViewEvents.CAPACITY_MODE, this.viewService.capacityViewMode);
      this._bus.emit(ViewEvents.SORT_MODE, this.viewService.featureSortMode);
      this._bus.emit(ViewEvents.HIGHLIGHT_RELATIONS, this.viewService.highlightFeatureRelationMode);
    }

    const mergedFilterPayload = {
      ...(filterPayload || {}),
      ...(this._viewRestoreFilterPayload || {}),
    };
    if (mergedFilterPayload && Object.keys(mergedFilterPayload).length > 0) {
      this._bus.emit(FilterEvents.CHANGED, mergedFilterPayload);
    }

    if (needsCapacity) {
      recomputeCapacityAndEmit(this, null, { onlyIfCalculated: true });
      this._viewRestorePerformedCapacityRecompute = true;
    }
    if (needsFeatureUpdate) {
      this.emitFeatureUpdated();
    }
    return true;
  }

  consumeViewRestoreCapacityRecomputeFlag() {
    const performed = !!this._viewRestorePerformedCapacityRecompute;
    this._viewRestorePerformedCapacityRecompute = false;
    return performed;
  }

  consumeStartupCapacityRecomputeFlag() {
    const performed = !!this._startupCapacityRecomputed;
    this._startupCapacityRecomputed = false;
    return performed;
  }

  _isViewRestoreBatchActive() {
    return this._viewRestoreBatchDepth > 0;
  }

  _queueViewRestoreCapacityRecompute() {
    this._viewRestoreNeedsCapacityRecompute = true;
  }

  _queueViewRestoreFeatureUpdate() {
    this._viewRestoreNeedsFeatureUpdate = true;
  }

  _queueViewRestoreSelectionEvent(eventName) {
    if (eventName === ProjectEvents.CHANGED) this._viewRestoreNeedsProjectEvent = true;
    if (eventName === TeamEvents.CHANGED) this._viewRestoreNeedsTeamEvent = true;
  }

  _queueViewRestoreFilterPayload(payload = {}) {
    if (!payload || typeof payload !== 'object') return;
    this._viewRestoreFilterPayload = {
      ...(this._viewRestoreFilterPayload || {}),
      ...payload,
    };
  }

  applyViewRestoreTransaction(payload = {}) {
    const hasStoreUpdate = typeof this._store?.update === 'function';
    if (!hasStoreUpdate) {
      this.applyViewSelectionRestore(payload);
      this.applyViewOptionsRestore(payload);
      return false;
    }

    const selectedProjectIds = selectedIdsFromSelections(payload.projectSelections);
    const selectedTeamIds = selectedIdsFromSelections(payload.teamSelections);
    const selectedStates =
      Array.isArray(payload.selectedStates) ? payload.selectedStates.filter(Boolean) : null;
    const nextTaskTypeNames =
      Array.isArray(payload.selectedTaskTypes) ?
        Array.from(new Set(payload.selectedTaskTypes.filter(Boolean)))
      : null;
    const nextTaskFilters =
      payload.resetTaskFilters ?
        defaultTaskFilters()
      : payload.taskFilters ?
        mergeRestoredTaskFilters(payload.taskFilters)
      : null;
    const normalizedViewOptions = normalizeViewOptionsForStore(payload.viewOptions);
    const expansion = payload.expansion && typeof payload.expansion === 'object' ? payload.expansion : null;

    const current = this._store.getState();
    const currentSelection = asObject(current.selection);
    const currentView = asObject(current.view);
    const currentViewOptions = asObject(currentView.options);
    const currentExpansion = asObject(currentView.expansion);

    const selectionUnchanged =
      (!payload.projectSelections || arrayShallowEqual(selectedProjectIds, asArray(currentSelection.projectIds))) &&
      (!payload.teamSelections || arrayShallowEqual(selectedTeamIds, asArray(currentSelection.teamIds))) &&
      (!selectedStates || arrayShallowEqual(selectedStates, asArray(currentSelection.featureStateNames))) &&
      (!nextTaskTypeNames || arrayShallowEqual(nextTaskTypeNames, asArray(currentSelection.taskTypeNames))) &&
      (!nextTaskFilters || deepEqualJsonLike(nextTaskFilters, asObject(currentSelection.taskFilters)));
    const viewUnchanged =
      (payload.savedViews === undefined || shallowEqualSavedViews(asArray(currentView.saved), asArray(payload.savedViews))) &&
      (payload.activeViewId === undefined || (payload.activeViewId || null) === (currentView.activeId || null)) &&
      Object.entries(normalizedViewOptions).every(([key, value]) => currentViewOptions[key] === value) &&
      (!expansion ||
        (expansion.expandParentChild === undefined || !!currentExpansion.parentChild === !!expansion.expandParentChild) &&
          (expansion.expandRelations === undefined || !!currentExpansion.relations === !!expansion.expandRelations) &&
          (expansion.expandTeamAllocated === undefined ||
            !!currentExpansion.teamAllocated === !!expansion.expandTeamAllocated));
    const needsCapacityOrFeatureUpdate =
      payload.projectSelections ||
      payload.teamSelections ||
      selectedStates ||
      nextTaskFilters ||
      nextTaskTypeNames ||
      expansion;

    if (selectionUnchanged && viewUnchanged) {
      return false;
    }

    const batchActive = this._isViewRestoreBatchActive();

    const startupCapacityUpdate = batchActive && this.isStartupPhaseActive();
    let capacityUpdatedInline = false;
    let featureUpdatedInline = false;

    this._store.update('view.restore.transaction.runtime', (draft) => {
      if (payload.savedViews !== undefined) {
        draft.view.saved = Array.isArray(payload.savedViews) ? payload.savedViews : [];
      }
      if (payload.activeViewId !== undefined) {
        draft.view.activeId = payload.activeViewId || null;
      }

      if (payload.projectSelections) draft.selection.projectIds = selectedProjectIds;
      if (payload.teamSelections) draft.selection.teamIds = selectedTeamIds;
      if (selectedStates) draft.selection.featureStateNames = selectedStates;
      if (nextTaskFilters) draft.selection.taskFilters = nextTaskFilters;
      if (nextTaskTypeNames) draft.selection.taskTypeNames = nextTaskTypeNames;

      if (Object.keys(normalizedViewOptions).length > 0) {
        draft.view.options = {
          ...asObject(draft.view.options),
          ...normalizedViewOptions,
        };
      }
      if (payload.graphType === 'team' || payload.graphType === 'project') {
        draft.view.options = {
          ...asObject(draft.view.options),
          capacityViewMode: payload.graphType,
        };
      }

      if (expansion) {
        if (expansion.expandParentChild !== undefined) {
          draft.view.expansion.parentChild = !!expansion.expandParentChild;
        }
        if (expansion.expandRelations !== undefined) {
          draft.view.expansion.relations = !!expansion.expandRelations;
        }
        if (expansion.expandTeamAllocated !== undefined) {
          draft.view.expansion.teamAllocated = !!expansion.expandTeamAllocated;
        }
      }

      if (needsCapacityOrFeatureUpdate && startupCapacityUpdate) {
        const { result } = this.calculateCapacityState(draft, null, {
          selectedStateIds: selectedStates,
        });
        draft.capacity = {
          ...(draft.capacity || {}),
          dates: result.dates,
          teamDaily: result.teamDailyCapacity,
          teamDailyMap: result.teamDailyCapacityMap,
          projectDailyRaw: result.projectDailyCapacityRaw,
          projectDaily: result.projectDailyCapacity,
          projectDailyMap: result.projectDailyCapacityMap,
          organizationDaily: result.totalOrgDailyCapacity,
          organizationDailyPerTeamAverage: result.totalOrgDailyPerTeamAvg,
        };
        capacityUpdatedInline = true;
        featureUpdatedInline = true;
      }
    });

    if (payload.projectSelections) {
      if (batchActive) this._queueViewRestoreSelectionEvent(ProjectEvents.CHANGED);
      else this._bus.emit(ProjectEvents.CHANGED, this.projects);
    }
    if (payload.teamSelections) {
      if (batchActive) this._queueViewRestoreSelectionEvent(TeamEvents.CHANGED);
      else this._bus.emit(TeamEvents.CHANGED, this.teams);
    }

    if (selectedStates) {
      this.stateFilterService.restoreFilterState({ selectedStates });
      const selectedStatesPayload = {
        selectedFeatureStateFilter: selectedStates,
      };
      if (batchActive) {
        this._queueViewRestoreFilterPayload(selectedStatesPayload);
      } else {
        this._bus.emit(FilterEvents.CHANGED, selectedStatesPayload);
      }
    }
    if (nextTaskFilters) {
      const taskFiltersPayload = {
        taskFilters: nextTaskFilters,
      };
      if (batchActive) {
        this._queueViewRestoreFilterPayload(taskFiltersPayload);
      } else {
        this._bus.emit(FilterEvents.CHANGED, taskFiltersPayload);
      }
    }
    if (payload.viewOptions) {
      this.viewService.restoreView(payload.viewOptions, !batchActive);
      if (batchActive) this._viewRestoreNeedsViewEvents = true;
    }
    if (payload.graphType === 'team' || payload.graphType === 'project') {
      this.setCapacityViewMode(payload.graphType, batchActive);
      if (batchActive) this._viewRestoreNeedsViewEvents = true;
    }
    if (nextTaskTypeNames) {
      if (batchActive) {
        this._queueViewRestoreFilterPayload({ selectedTaskTypes: nextTaskTypeNames });
      } else {
        this._bus.emit(FilterEvents.CHANGED, { selectedTaskTypes: nextTaskTypeNames });
      }
    }
    if (expansion && payload.emitExpansionFilterChange) {
      const expansionPayload = {
        expansion: {
          parentChild: !!expansion.expandParentChild,
          relations: !!expansion.expandRelations,
          teamAllocated: !!expansion.expandTeamAllocated,
        },
      };
      if (batchActive) {
        this._queueViewRestoreFilterPayload(expansionPayload);
      } else {
        this._bus.emit(FilterEvents.CHANGED, expansionPayload);
      }
    }

    if (needsCapacityOrFeatureUpdate) {
      if (startupCapacityUpdate) {
        this._viewRestorePerformedCapacityRecompute = true;
        this._startupCapacityRecomputed = true;
      } else if (batchActive) {
        this._queueViewRestoreCapacityRecompute();
        this._queueViewRestoreFeatureUpdate();
      } else {
        recomputeCapacityAndEmit(this, null, { onlyIfCalculated: true });
        this.emitFeatureUpdated();
      }
    }

    if (capacityUpdatedInline) {
      this.emitCapacityUpdated();
    }
    if (featureUpdatedInline) {
      this.emitFeatureUpdated();
    }

    return true;
  }

  applyViewSelectionRestore(payload = {}) {
    if (payload.projectSelections) this._bindings.commands.setProjectsSelectedBulk(payload.projectSelections);
    if (payload.teamSelections) this._bindings.commands.setTeamsSelectedBulk(payload.teamSelections);
    if (Array.isArray(payload.selectedStates)) this.setSelectedStates(payload.selectedStates);
    if (payload.resetTaskFilters) this.taskFilterService.resetFilters();
    else if (payload.taskFilters) this.taskFilterService.restoreFilters(payload.taskFilters);
  }

  planViewRestoreUiEffects(payload = {}) {
    return planViewRestoreUiEffects(payload);
  }

  applyViewOptionsRestore(payload = {}) {
    if (payload.viewOptions) {
      this.viewService.restoreView(payload.viewOptions, !this._isViewRestoreBatchActive());
      if (this._isViewRestoreBatchActive()) this._viewRestoreNeedsViewEvents = true;
    }
    if (payload.graphType) {
      this.setCapacityViewMode(payload.graphType, this._isViewRestoreBatchActive());
      if (this._isViewRestoreBatchActive()) this._viewRestoreNeedsViewEvents = true;
    }
    if (Array.isArray(payload.selectedTaskTypes)) {
      if (this._isViewRestoreBatchActive()) {
        this._queueViewRestoreFilterPayload({ selectedTaskTypes: payload.selectedTaskTypes });
      } else {
        this._bus.emit(FilterEvents.CHANGED, { selectedTaskTypes: payload.selectedTaskTypes });
      }
    }
    if (payload.expansion) {
      this._bindings.commands.setExpansionState(payload.expansion);
      if (payload.emitExpansionFilterChange) {
        const expansionPayload = {
          expansion: {
            parentChild: !!payload.expansion.expandParentChild,
            relations: !!payload.expansion.expandRelations,
            teamAllocated: !!payload.expansion.expandTeamAllocated,
          },
        };
        if (this._isViewRestoreBatchActive()) {
          this._queueViewRestoreFilterPayload(expansionPayload);
        } else {
          this._bus.emit(FilterEvents.CHANGED, expansionPayload);
        }
      }
    }
  }

  async applyViewPluginStateRestore(payload = {}) {
    await this.pluginStateService.restoreFromView(payload.pluginState || {});
    return true;
  }

  markActiveScenarioChanged(activeScenario = this.getActiveWritableScenario()) {
    if (activeScenario) activeScenario.isChanged = true;
    this.emitScenarioList();
  }

  saveScenarioPayload(payload) {
    return this._dataService.saveScenario(payload);
  }

  async performAutosave({ logFailures = true } = {}) {
    return performAutosave(this, { logFailures });
  }

  recomputeCapacityMetrics(changedFeatureIds = null) {
    const probe = startPerfProbe('runtime.recomputeCapacityMetrics', {
      changedFeatureCount: Array.isArray(changedFeatureIds) ? changedFeatureIds.length : 0,
    });
    const {
      result,
      calculated,
      effectiveFeatureCount,
      selectedProjectCount,
      selectedTeamCount,
    } = this.calculateCapacityState(this._store.getState(), changedFeatureIds);
    this.replaceCapacityState({
      dates: result.dates,
      teamDaily: result.teamDailyCapacity,
      teamDailyMap: result.teamDailyCapacityMap,
      projectDailyRaw: result.projectDailyCapacityRaw,
      projectDaily: result.projectDailyCapacity,
      projectDailyMap: result.projectDailyCapacityMap,
      organizationDaily: result.totalOrgDailyCapacity,
      organizationDailyPerTeamAverage: result.totalOrgDailyPerTeamAvg,
    });
    if (this.isStartupPhaseActive()) {
      this._startupCapacityRecomputed = true;
    }
    endPerfProbe(probe, {
      calculated: !!calculated,
      effectiveFeatureCount,
      selectedProjectCount,
      selectedTeamCount,
    });
    return calculated;
  }

  emitCapacityUpdated() {
    const capacity = this._store.getState().capacity || {};
    this._bus.emit(
      CapacityEvents.UPDATED,
      selectCapacityEventPayload(capacity)
    );
  }

  emitFeatureUpdated(ids = []) {
    this._bus.emit(FeatureEvents.UPDATED, { ids: Array.isArray(ids) ? ids.filter(Boolean) : [] });
  }

  async destroy() {
    this._unsubscribeScenariosChanged?.();
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