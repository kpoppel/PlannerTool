function cloneValue(value) {
  return value == null ? null : structuredClone(value);
}

const LAST_VIEW_ID_STORAGE_KEY = 'az_planner:last_view_id';

function getDefaultViewOptions() {
  return {
    timelineScale: 'months',
    condensedCards: false,
    featureSortMode: 'rank',
    capacityViewMode: 'team',
    displayMode: 'normal',
    packedMode: false,
    showDependencies: false,
    showUnassignedCards: false,
    showUnplannedWork: false,
    showOnlyProjectHierarchy: false,
    hiddenTypes: [],
    expandParentChild: false,
    expandRelations: false,
    expandTeamAllocated: false,
  };
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

export function createLegacyViewRestoreCommands(state) {
  return {
    loadAndApplyView(viewId) {
      return state.viewManagementService?.loadAndApplyView(viewId);
    },

    saveCurrentView(name, viewId = null) {
      return state.viewManagementService?.saveCurrentView(name, viewId);
    },

    renameView(viewId, newName) {
      return state.viewManagementService?.renameView(viewId, newName);
    },

    deleteView(viewId) {
      return state.viewManagementService?.deleteView(viewId);
    },

    loadViews() {
      return state.viewManagementService?.loadViews();
    },

    restoreLastView() {
      return state.viewManagementService?.restoreLastView();
    },

    captureCurrentView() {
      return state.captureCurrentView?.() || {};
    },
  };
}

export function createViewRestoreCommands(store, dataService, legacyState = null) {
  function setViews(views, activeId = null) {
    store.setState(
      (state) => ({
        ...state,
        view: {
          ...state.view,
          saved: Array.isArray(views) ? cloneValue(views) : [],
          ...(activeId !== null ? { activeId } : {}),
        },
      }),
      false,
      'viewRestore.setViews'
    );
  }

  async function restorePluginState(pluginState) {
    if (typeof legacyState?.restorePluginStateFromView === 'function') {
      await legacyState.restorePluginStateFromView(pluginState || {});
      return;
    }
    await legacyState?.pluginStateService?.restoreFromView?.(pluginState || {});
  }

  function applyViewToStore(viewId, viewData) {
    const snapshot = store.getState();
    const viewOptions = cloneValue(viewData?.viewOptions || {});
    const isDefault = String(viewId) === 'default';

    const defaultProjectSelections = Object.fromEntries(
      (snapshot?.baseline?.projects || []).map((project) => [String(project?.id), true])
    );
    const defaultTeamSelections = Object.fromEntries(
      (snapshot?.baseline?.teams || []).map((team) => [String(team?.id), true])
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
      : (isDefault ? [] : (snapshot.selection?.featureStateNames || []));

    const selectedTaskTypes =
      Array.isArray(viewOptions.selectedTaskTypes) ?
        Array.from(viewOptions.selectedTaskTypes)
      : (isDefault ? [] : (snapshot.selection?.taskTypeNames || []));

    const nextViewOptions = isDefault ?
      getDefaultViewOptions()
    : {
        ...(snapshot.view?.options || {}),
        ...viewOptions,
      };

    const nextTaskFilters =
      viewOptions.taskFilters && typeof viewOptions.taskFilters === 'object' ?
        {
          ...(snapshot.selection?.taskFilters || {}),
          ...viewOptions.taskFilters,
        }
      : (isDefault ? { schedule: null, allocation: null, hierarchy: null, relations: null } :
          (snapshot.selection?.taskFilters || {}));

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
        view: {
          ...state.view,
          activeId: viewId,
          options: nextViewOptions,
          expansion: toViewExpansion(state.view?.expansion, nextViewOptions),
        },
      }),
      false,
      'viewRestore.applyViewPayload'
    );
  }

  return {
    async loadViews() {
      const views = (await dataService.listViews()) || [];
      setViews(views);
      return views;
    },

    async saveCurrentView(name, viewId = null) {
      const snapshot = store.getState();
      const payload = {
        id: viewId,
        name,
        selectedProjects: Object.fromEntries(
          (snapshot.selection?.projectIds || []).map((id) => [String(id), true])
        ),
        selectedTeams: Object.fromEntries(
          (snapshot.selection?.teamIds || []).map((id) => [String(id), true])
        ),
        viewOptions: cloneValue(snapshot.view?.options || {}),
      };
      const response = await dataService.saveView(payload);
      const nextViews = (await dataService.listViews()) || [];
      setViews(nextViews, response?.id || null);
      return response;
    },

    async renameView(viewId, newName) {
      await dataService.renameView(viewId, newName);
      const nextViews = (await dataService.listViews()) || [];
      setViews(nextViews);
    },

    async deleteView(viewId) {
      await dataService.deleteView(viewId);
      const nextViews = (await dataService.listViews()) || [];
      const activeId = store.getState().view?.activeId;
      setViews(nextViews, activeId === viewId ? null : activeId);
    },

    async loadAndApplyView(viewId) {
      const id = String(viewId || 'default');
      const savedViews = store.getState().view?.saved || [];

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
      await restorePluginState(viewData?.viewOptions?.pluginState || {});
      writeLastViewId(id);
      return id;
    },

    async restoreLastView() {
      const existingViews = store.getState().view?.saved || [];
      if (!existingViews.length) {
        await this.loadViews();
      }

      const availableViews = store.getState().view?.saved || [];
      const preferredId =
        readLastViewId() ||
        store.getState().view?.activeId ||
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
      return {
        viewOptions: cloneValue(snapshot.view?.options || {}),
      };
    },
  };
}