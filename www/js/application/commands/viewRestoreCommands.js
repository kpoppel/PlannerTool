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
  const nextViews = Array.isArray(views) ? [...views] : [];
  const defaultIndex = nextViews.findIndex((view) => String(view?.id) === DEFAULT_VIEW_ID);
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

function getDefaultViewOptions() {
  return {
    timelineScale: 'months',
    condensedCards: false,
    featureSortMode: 'rank',
    capacityViewMode: 'team',
    displayMode: 'normal',
    packedMode: false,
    showDependencies: false,
    showUnassignedCards: true,
    showUnplannedWork: true,
    showOnlyProjectHierarchy: false,
    highlightFeatureRelationMode: true,
    hiddenTypes: [],
    expandParentChild: false,
    expandRelations: false,
    expandTeamAllocated: false,
  };
}

function deriveAvailableFeatureStates(snapshot) {
  const fromFilterState = Array.isArray(snapshot?.filter?.availableFeatureStates) ?
    snapshot.filter.availableFeatureStates
  : [];
  if (fromFilterState.length > 0) {
    return Array.from(new Set(fromFilterState.map((stateName) => String(stateName))));
  }

  const fromFeatures = [];
  const seen = new Set();
  for (const feature of snapshot?.baseline?.features || []) {
    const stateName = feature?.state;
    if (!stateName) continue;
    const key = String(stateName);
    if (seen.has(key)) continue;
    seen.add(key);
    fromFeatures.push(key);
  }
  return fromFeatures;
}

function deriveAvailableTaskTypes(snapshot) {
  const fromFeatures = [];
  const seen = new Set();
  for (const feature of snapshot?.baseline?.features || []) {
    const typeName = feature?.type ?? feature?.workItemType ?? feature?.work_item_type;
    if (!typeName) continue;
    const key = String(typeName);
    if (seen.has(key)) continue;
    seen.add(key);
    fromFeatures.push(key);
  }
  return fromFeatures;
}

function toSelectedIds(selectionMap) {
  if (!selectionMap || typeof selectionMap !== 'object') return [];
  return Object.entries(selectionMap)
    .filter(([, selected]) => selected === true)
    .map(([id]) => String(id));
}

function toViewExpansion(existingExpansion, options = {}) {
  return {
    parentChild:
      options.expandParentChild !== undefined ?
        Boolean(options.expandParentChild)
      : Boolean(existingExpansion?.parentChild),
    relations:
      options.expandRelations !== undefined ?
        Boolean(options.expandRelations)
      : Boolean(existingExpansion?.relations),
    teamAllocated:
      options.expandTeamAllocated !== undefined ?
        Boolean(options.expandTeamAllocated)
      : Boolean(existingExpansion?.teamAllocated),
  };
}

function toSelectedMap(ids) {
  return Object.fromEntries((ids || []).map((id) => [String(id), true]));
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

export function createViewRestoreCommands(store, dataService, pluginStateCommands = null) {
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
    await pluginStateCommands.restoreFromView(pluginState);
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
      : toSelectedIds(viewData?.selectedProjects || {});
    const selectedTeams =
      isDefault ?
        toSelectedIds(defaultTeamSelections)
      : toSelectedIds(viewData?.selectedTeams || {});

    const selectedStates =
      Array.isArray(viewOptions.selectedFeatureStates) ?
        Array.from(viewOptions.selectedFeatureStates)
      :
        (isDefault ?
          deriveAvailableFeatureStates(snapshot)
        : (snapshot.selection?.featureStateNames || []));

    const selectedTaskTypes =
      Array.isArray(viewOptions.selectedTaskTypes) ?
        Array.from(viewOptions.selectedTaskTypes)
      :
        (isDefault ?
          deriveAvailableTaskTypes(snapshot)
        : (snapshot.selection?.taskTypeNames || []));

    const nextViewOptions = isDefault ?
      getDefaultViewOptions()
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
          activeId: isDefault ? 'baseline' : state.scenarios?.activeId,
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
      ...(viewData || {}),
      id,
      selectedProjects: toSelectedMap(projectIds),
      selectedTeams: toSelectedMap(teamIds),
      viewOptions: toActiveViewOptions(snapshot, viewData.viewOptions || {}),
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

  return {
    async loadViews() {
      const views = withSyntheticDefaultView((await dataService.listViews()) || []);
      setViews(views);
      return views;
    },

    async saveCurrentView(name, viewId = null) {
      const snapshot = store.getState();
      const pluginState = pluginStateCommands.captureForView();
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
      const nextViews = withSyntheticDefaultView((await dataService.listViews()) || []);
      setViews(nextViews, response?.id || null);
      const savedViewData =
        nextViews.find((v) => String(v?.id) === String(response?.id)) || response;
      bus.emit(ViewManagementEvents.ACTIVATED, {
        id: response?.id,
        viewId: response?.id,
        data: savedViewData,
        activeViewData: savedViewData,
      });
      return response;
    },

    async renameView(viewId, newName) {
      await dataService.renameView(viewId, newName);
      const nextViews = withSyntheticDefaultView((await dataService.listViews()) || []);
      setViews(nextViews);
    },

    async deleteView(viewId) {
      await dataService.deleteView(viewId);
      const nextViews = withSyntheticDefaultView((await dataService.listViews()) || []);
      const activeId = store.getState().view?.activeId;
      setViews(nextViews, activeId === viewId ? null : activeId);
    },

    async loadAndApplyView(viewId) {
      const id = String(viewId || 'default');
      const savedViews = store.getState().view.saved;

      let viewData;
      if (id === 'default') {
        viewData =
          savedViews.find((view) => String(view?.id) === 'default') ||
          {
            id: 'default',
            name: 'Default View',
            selectedProjects: {},
            selectedTeams: {},
            viewOptions: {},
            readonly: true,
          };
      } else {
        viewData = await dataService.getView(id);
        if (!viewData) {
          throw new Error(`View not found: ${id}`);
        }
      }

      applyViewToStore(id, viewData);
      emitViewApplied(id, viewData);
      await restorePluginState(viewData?.viewOptions?.pluginState || {});
      writeLastViewId(id);
      return id;
    },

    async restoreLastView() {
      const existingViews = store.getState().view.saved;
      if (!existingViews.length) {
        await this.loadViews();
      }

      const availableViews = store.getState().view.saved;
      const preferredId =
        readLastViewId() ||
        store.getState().view.activeId ||
        'default';
      const hasPreferred =
        preferredId === 'default' ||
        availableViews.some((view) => String(view?.id) === String(preferredId));

      const targetId = hasPreferred ? String(preferredId) : 'default';
      await this.loadAndApplyView(targetId);
      return true;
    },

    captureCurrentView() {
      const snapshot = store.getState();
      return buildViewSnapshotOptions(snapshot);
    },
  };
}