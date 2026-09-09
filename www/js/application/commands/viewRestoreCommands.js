import { bus } from '../../core/EventBus.js';
import {
  CapacityEvents,
  ProjectEvents,
  TeamEvents,
  FeatureEvents,
  FilterEvents,
  ViewEvents,
  ViewManagementEvents,
} from '../../core/EventRegistry.js';
import { getAllTaskFiltersEnabled } from '../shared/taskFilters.js';
import { createDefaultViewOptions } from '../shared/viewDefaults.js';
import {
  deriveAvailableFeatureStates,
  deriveAvailableTaskTypes,
} from '../shared/stateDerivations.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

function cloneValue(value) {
  return value == null ? null : structuredClone(value);
}

const LAST_VIEW_ID_STORAGE_KEY = 'az_planner:last_view_id';

const DEFAULT_VIEW_ID = 'default';

function createSyntheticDefaultView() {
  return {
    id: DEFAULT_VIEW_ID,
    name: 'Default View',
    readonly: true,
    selectedProjects: {},
    selectedTeams: {},
    viewOptions: {},
  };
}

function withSyntheticDefaultView(views) {
  const nextViews = [...views];
  const defaultIndex = nextViews.findIndex((view) => String(view.id) === DEFAULT_VIEW_ID);
  const syntheticDefaultView = createSyntheticDefaultView();

  if (defaultIndex === -1) {
    nextViews.unshift(syntheticDefaultView);
    return nextViews;
  }

  nextViews[defaultIndex] = {
    ...nextViews[defaultIndex],
    ...syntheticDefaultView,
  };
  return nextViews;
}

function deriveDefaultFeatureStates(snapshot) {
  return deriveAvailableFeatureStates(snapshot.baseline.features);
}

function deriveDefaultTaskTypes(snapshot) {
  return deriveAvailableTaskTypes(snapshot.baseline.features);
}

function toSelectedIds(selectionMap) {
  return Object.entries(selectionMap)
    .filter(([, selected]) => selected === true)
    .map(([id]) => String(id));
}

function toViewExpansion(existingExpansion, options = {}) {
  return {
    parentChild:
      options.expandParentChild !== undefined ?
        Boolean(options.expandParentChild)
      : Boolean(existingExpansion.parentChild),
    relations:
      options.expandRelations !== undefined ?
        Boolean(options.expandRelations)
      : Boolean(existingExpansion.relations),
    teamAllocated:
      options.expandTeamAllocated !== undefined ?
        Boolean(options.expandTeamAllocated)
      : Boolean(existingExpansion.teamAllocated),
  };
}

function toSelectedMap(ids) {
  return Object.fromEntries(ids.map((id) => [String(id), true]));
}

function buildViewSnapshotOptions(snapshot, pluginState = {}) {
  return {
    ...cloneValue(snapshot.view.options),
    selectedFeatureStates: Array.from(snapshot.selection.featureStateNames),
    selectedTaskTypes: Array.from(snapshot.selection.taskTypeNames),
    taskFilters: cloneValue(snapshot.selection.taskFilters),
    expandParentChild: Boolean(snapshot.view.expansion.parentChild),
    expandRelations: Boolean(snapshot.view.expansion.relations),
    expandTeamAllocated: Boolean(snapshot.view.expansion.teamAllocated),
    ...pluginState,
  };
}

function toActiveViewOptions(snapshot, existingViewOptions = {}) {
  return {
    ...existingViewOptions,
    ...buildViewSnapshotOptions(snapshot),
  };
}

function readLastViewId() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LAST_VIEW_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastViewId(viewId) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (viewId == null) localStorage.removeItem(LAST_VIEW_ID_STORAGE_KEY);
    else localStorage.setItem(LAST_VIEW_ID_STORAGE_KEY, String(viewId));
  } catch {
    // Ignore persistence failures (e.g. tests / blocked storage).
  }
}

/**
 * @param {StoreApi} store
 * @param {any} dataService
 * @param {any|null} [pluginStateCommands]
 * @param {(() => void)|null} [recomputeCapacity]
 * @returns {object}
 */
export function createViewRestoreCommands(
  store,
  dataService,
  pluginStateCommands = null,
  recomputeCapacity = null
) {
  const pluginStateApi = pluginStateCommands === null ? {
    captureForView: () => ({}),
    restoreFromView: async () => {},
  } : pluginStateCommands;

  function requireRecomputeCapacity() {
    if (typeof recomputeCapacity !== 'function') {
      throw new TypeError('viewRestoreCommands requires recomputeCapacity');
    }
  }

  /**
   * @param {any[]} views
   * @param {string|null} [activeId]
   */
  function setViews(views, activeId = null) {
    const nextViews = withSyntheticDefaultView(views);
    const nextActiveId = activeId !== null ? activeId : store.getState().view.activeId;
    store.setState(
      (state) => ({
        ...state,
        view: {
          ...state.view,
          saved: cloneValue(nextViews),
          ...(activeId !== null ? { activeId } : {}),
        },
      }),
      false,
      'viewRestore.setViews'
    );
    bus.emit(ViewManagementEvents.LIST, {
      views: nextViews,
      activeViewId: nextActiveId,
    });
  }

  async function restorePluginState(pluginState) {
    await pluginStateApi.restoreFromView(pluginState);
  }

  function applyViewToStore(viewId, viewData) {
    const snapshot = store.getState();
    const isDefault = String(viewId) === 'default';

    const viewOptions = cloneValue(viewData.viewOptions);

    const defaultProjectSelections = Object.fromEntries(
      snapshot.baseline.projects.map((project) => [String(project.id), true])
    );

    const defaultTeamSelections = Object.fromEntries(
      snapshot.baseline.teams.map((team) => [String(team.id), true])
    );

    const selectedProjects =
      isDefault ?
        toSelectedIds(defaultProjectSelections)
      : toSelectedIds(viewData.selectedProjects);
    const selectedTeams =
      isDefault ?
        toSelectedIds(defaultTeamSelections)
      : toSelectedIds(viewData.selectedTeams);

    const selectedStates =
      viewOptions.selectedFeatureStates instanceof Array ?
        Array.from(viewOptions.selectedFeatureStates)
      :
        (isDefault ?
          deriveDefaultFeatureStates(snapshot)
        : snapshot.selection.featureStateNames);

    const selectedTaskTypes =
      viewOptions.selectedTaskTypes instanceof Array ?
        Array.from(viewOptions.selectedTaskTypes)
      :
        (isDefault ?
          deriveDefaultTaskTypes(snapshot)
        : snapshot.selection.taskTypeNames);

    const nextViewOptions = isDefault ?
      createDefaultViewOptions()
    : {
        ...snapshot.view.options,
        ...viewOptions,
      };

    const nextTaskFilters =
      viewOptions.taskFilters && typeof viewOptions.taskFilters === 'object' ?
        {
          ...snapshot.selection.taskFilters,
          ...viewOptions.taskFilters,
        }
      :
        (isDefault ?
          getAllTaskFiltersEnabled()
        :
          snapshot.selection.taskFilters);

    store.setState(
      (state) => ({
        ...state,
        selection: {
          ...state.selection,
          projectIds: selectedProjects,
          teamIds: selectedTeams,
          featureStateNames: selectedStates,
          taskTypeNames: selectedTaskTypes,
          taskFilters: nextTaskFilters,
        },
        scenarios: {
          ...state.scenarios,
          activeId: isDefault ? 'baseline' : state.scenarios.activeId,
        },
        view: {
          ...state.view,
          activeId: viewId,
          options: nextViewOptions,
          expansion: toViewExpansion(state.view.expansion, nextViewOptions),
        },
      }),
      false,
      'viewRestore.applyViewPayload'
    );
  }

  // Bridge: emit compatibility events from store state so board/timeline components re-render.
  function emitViewApplied(id, viewData) {
    const snapshot = store.getState();
    const projectIds = Array.from(snapshot.selection.projectIds);
    const teamIds = Array.from(snapshot.selection.teamIds);

    const activeViewData = {
      ...viewData,
      id,
      selectedProjects: toSelectedMap(projectIds),
      selectedTeams: toSelectedMap(teamIds),
      viewOptions: toActiveViewOptions(snapshot, viewData.viewOptions),
    };

    // Keep the sidebar and board UI in sync with the newly-applied saved view.
    // These events are what the sidebar listens to for task filters and graph type.
    bus.emit(ProjectEvents.CHANGED);
    bus.emit(TeamEvents.CHANGED);
    bus.emit(FilterEvents.CHANGED);
    bus.emit(CapacityEvents.UPDATED);
    bus.emit(ViewEvents.CAPACITY_MODE);
    bus.emit(ViewEvents.DEPENDENCIES);
    bus.emit(ViewEvents.CONDENSED);
    bus.emit(ViewEvents.SORT_MODE);
    bus.emit(FeatureEvents.UPDATED);
    bus.emit(ViewManagementEvents.ACTIVATED, {
      id,
      viewId: id,
      data: activeViewData,
      activeViewData,
    });
  }

  const commands = {
    async loadViews() {
      const views = withSyntheticDefaultView(await dataService.listViews());
      setViews(views);
      return views;
    },

    async saveCurrentView(name, viewId = null) {
      const snapshot = store.getState();
      const pluginState = pluginStateApi.captureForView();
      const viewOptions = buildViewSnapshotOptions(snapshot, pluginState);
      const payload = {
        id: viewId,
        name,
        selectedProjects: Object.fromEntries(
          snapshot.selection.projectIds.map((id) => [String(id), true])
        ),
        selectedTeams: Object.fromEntries(
          snapshot.selection.teamIds.map((id) => [String(id), true])
        ),
        viewOptions,
      };
      const response = await dataService.saveView(payload);
      const nextViews = withSyntheticDefaultView(await dataService.listViews());
      const responseId = response.id === undefined ? null : response.id;
      setViews(nextViews, responseId);
      const savedViewData =
        nextViews.find((v) => String(v.id) === String(response.id));
      bus.emit(ViewManagementEvents.ACTIVATED, {
        id: response.id,
        viewId: response.id,
        data: savedViewData,
        activeViewData: savedViewData,
      });
      return response;
    },

    async renameView(viewId, newName) {
      await dataService.renameView(viewId, newName);
      const nextViews = withSyntheticDefaultView(await dataService.listViews());
      setViews(nextViews);
    },

    async deleteView(viewId) {
      await dataService.deleteView(viewId);
      const nextViews = withSyntheticDefaultView(await dataService.listViews());
      const activeId = store.getState().view.activeId;
      setViews(nextViews, activeId === viewId ? null : activeId);
    },

    async loadAndApplyView(viewId) {
      const id = String(viewId);
      const savedViews = store.getState().view.saved;

      let viewData;
      if (id === 'default') {
        viewData =
          savedViews.find((view) => String(view.id) === 'default');
      } else {
        viewData = await dataService.getView(id);
        if (viewData === null) {
          throw new Error(`View not found: ${id}`);
        }
      }

      applyViewToStore(id, viewData);
      // Team/project selection changed: capacity was computed against the previous
      // selection, so it must be recalculated before emitViewApplied's CapacityEvents.UPDATED
      // signal reaches listeners (e.g. MainGraph), otherwise newly-selected teams show no data.
      requireRecomputeCapacity();
      recomputeCapacity();
      emitViewApplied(id, viewData);
      await restorePluginState(viewData.viewOptions.pluginState);
      writeLastViewId(id);
      return id;
    },

    async restoreLastView() {
      const existingViews = store.getState().view.saved;
      if (!existingViews.length) {
        await commands.loadViews();
      }

      const availableViews = store.getState().view.saved;
      const savedLastViewId = readLastViewId();
      const preferredId = savedLastViewId === null ? store.getState().view.activeId : savedLastViewId;
      let hasPreferred = false;
      if (preferredId === 'default') {
        hasPreferred = true;
      } else if (availableViews.some((view) => String(view.id) === String(preferredId))) {
        hasPreferred = true;
      }

      const targetId = hasPreferred ? String(preferredId) : 'default';
      await commands.loadAndApplyView(targetId);
      return true;
    },

    captureCurrentView() {
      const snapshot = store.getState();
      return buildViewSnapshotOptions(snapshot);
    },
  };

  return commands;
}