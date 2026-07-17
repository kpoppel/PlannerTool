/**
 * ViewManagementService
 *
 * Manages saved view configurations (selected projects/teams, view options).
 * Handles loading, saving, and deleting views via backend API.
 *
 * A view captures:
 * - selectedProjects: which projects are selected
 * - selectedTeams: which teams are selected
 * - viewOptions: timeline scale, capacity mode, filters, etc.
 */

import { dataService } from './dataService.js';
import { ViewManagementEvents, FilterEvents } from '../core/EventRegistry.js';
import { getDefaultViewOptions } from '../config/viewDefaults.js';
import { dataOr } from './result.js';

const DEFAULT_VIEW_MGMT_ENV = {
  storage: {
    getItem: () => null,
    setItem: () => {},
  },
  events: {
    emitViewsList: (bus, payload) => {
      bus?.emit?.(ViewManagementEvents.LIST, payload);
    },
    emitViewActivated: (bus, payload) => {
      bus?.emit?.(ViewManagementEvents.ACTIVATED, payload);
    },
    emitFilterChanged: (bus, payload) => {
      bus?.emit?.(FilterEvents.CHANGED, payload);
    },
  },
  ui: {
    getSidebarElement: () => null,
    setSelectedTaskTypes: (sidebarElement, selectedTaskTypes) => {
      if (!sidebarElement) return;
      sidebarElement.selectedTaskTypes = new Set(selectedTaskTypes || []);
    },
    setGraphType: (sidebarElement, graphType) => {
      if (!sidebarElement || !graphType) return;
      if (typeof sidebarElement._graphType !== 'undefined') {
        sidebarElement._graphType = graphType;
      }
    },
    setExpansionState: (sidebarElement, expansion) => {
      if (!sidebarElement || !expansion) return;
      sidebarElement.expandParentChild = expansion.expandParentChild;
      sidebarElement.expandRelations = expansion.expandRelations;
      sidebarElement.expandTeamAllocated = expansion.expandTeamAllocated;
    },
    recomputeDataFunnel: (sidebarElement) => {
      sidebarElement?._recomputeDataFunnel?.();
    },
    requestSidebarUpdate: (sidebarElement) => {
      sidebarElement?.requestUpdate?.();
    },
  },
};

export class ViewManagementService {
  constructor(bus, state, viewService, env = {}) {
    this._bus = bus;
    this._state = state;
    this._viewService = viewService;
    this._activeViewData = null; // Full data of currently active view (for filtering)
    this._lastViewIdStorageKey = 'az_planner:last_view_id';
    this._inFlightLoadPromise = null;
    this._inFlightLoadViewId = null;
    this._deferredViews = null;
    this._deferredActiveId = null;
    this._startupRestoreCompleted = false;
    this._startupRestorePromise = null;
    this.setEnvironment(env);
  }

  setEnvironment(env = {}) {
    this._env = {
      storage: {
        ...DEFAULT_VIEW_MGMT_ENV.storage,
        ...(env.storage || {}),
      },
      events: {
        ...DEFAULT_VIEW_MGMT_ENV.events,
        ...(env.events || {}),
      },
      ui: {
        ...DEFAULT_VIEW_MGMT_ENV.ui,
        ...(env.ui || {}),
      },
    };
  }

  _getSidebarElement() {
    return this._env?.ui?.getSidebarElement?.() || null;
  }

  _getViews() {
    const current = this._state?.savedViews || [];
    if (current.length > 0) return current;
    return this._deferredViews || [];
  }

  _getActiveViewId() {
    return this._state?.activeViewId || this._deferredActiveId || null;
  }

  _syncViewState({ views, activeId } = {}) {
    this._state?.replaceViewState?.({ saved: views, activeId });
  }

  _createDefaultView() {
    return {
      id: 'default',
      name: 'Default View',
      readonly: true,
      // Default view has no filters - shows everything
      selectedProjects: {},
      selectedTeams: {},
      viewOptions: {},
    };
  }

  _composeViews(userViews = []) {
    const existingDefault = this._getViews().find((view) => view.id === 'default');
    const views = [];
    const seenIds = new Set();

    const addUniqueView = (view) => {
      if (!view || !view.id || seenIds.has(view.id)) return;
      seenIds.add(view.id);
      views.push(view);
    };

    addUniqueView(existingDefault || this._createDefaultView());
    (Array.isArray(userViews) ? userViews : []).forEach((view) => {
      if (view?.id === 'default') return;
      addUniqueView(view);
    });

    return views;
  }

  /**
   * Initialize default view (readonly view that shows all)
   */
  initDefaultView() {
    const DEFAULT_ID = 'default';
    const views = this._getViews();
    const existing = views.find((v) => v.id === DEFAULT_ID);

    if (!existing) {
      const defaultView = this._createDefaultView();
      this._syncViewState({ views: [defaultView, ...views], activeId: this._getActiveViewId() || DEFAULT_ID });
    }
  }

  /**
   * Load all views from backend
   * @returns {Promise<Array>} Array of view metadata
   */
  async loadViews(options = {}) {
    const deferStateSync = !!options.deferStateSync;
    if (deferStateSync) {
      this._startupRestoreCompleted = false;
    }
    try {
      const userViews = dataOr(await dataService.listViews(), []) || [];
      console.log('[ViewManagementService] Loaded user views:', userViews);

      const views = this._composeViews(userViews);

      const activeId =
        views.find((view) => view.id === this._getActiveViewId())?.id ||
        views.find((view) => view.readonly)?.id ||
        views[0]?.id ||
        'default';
      if (deferStateSync) {
        this._deferredViews = views;
        this._deferredActiveId = activeId;
      } else {
        this._deferredViews = null;
        this._deferredActiveId = null;
        this._syncViewState({ views, activeId });
      }

      console.log('[ViewManagementService] Total views:', views);
      if (!deferStateSync) this._emitViewsList();
      return views;
    } catch (err) {
      console.error('[ViewManagementService] Error loading views:', err);
      const views = this._composeViews(this._getViews());
      const activeId = views.find((view) => view.readonly)?.id || views[0]?.id || null;
      if (deferStateSync) {
        this._deferredViews = views;
        this._deferredActiveId = activeId;
      } else {
        this._deferredViews = null;
        this._deferredActiveId = null;
        this._syncViewState({ views, activeId });
        this._emitViewsList();
      }
      return views;
    }
  }

  /**
   * Save current view configuration
   * @param {string} name - View name
   * @param {string} [viewId] - Optional view ID (for updating existing view)
   * @returns {Promise<Object>} Saved view metadata
   */
  async saveCurrentView(name, viewId = null) {
    try {
      // Capture current state (projects, teams, view options)
      const currentState = this._captureCurrentState();

      const viewData = {
        id: viewId,
        name: name,
        selectedProjects: currentState.projects || {},
        selectedTeams: currentState.teams || {},
        viewOptions: currentState.viewOptions || {},
      };

      const response = dataOr(await dataService.saveView(viewData), null);
      if (!response) {
        throw new Error('Failed to save view');
      }

      console.log('[ViewManagementService] Saved view:', response);

      // Set the active view to the saved/updated view
      this._syncViewState({ activeId: response.id });
      this._activeViewData = response;

      // Reload views list (this will emit LIST event with updated activeViewId)
      await this.loadViews();

      // Also emit view activated event to ensure UI is fully synced
      this._emitViewActivated();

      return response;
    } catch (err) {
      console.error('[ViewManagementService] Error saving view:', err);
      throw err;
    }
  }

  /**
   * Load and apply a saved view
   * @param {string} viewId - View ID to load
   * @returns {Promise<void>}
   */
  async loadAndApplyView(viewId, options = {}) {
    const startup = !!options.startup;
    if (startup && this._startupRestoreCompleted && !this._deferredViews) {
      return;
    }
    if (
      this._getActiveViewId() === viewId &&
      this._activeViewData?.id === viewId &&
      !this._deferredViews
    ) {
      if (startup) this._startupRestoreCompleted = true;
      return;
    }

    if (this._inFlightLoadPromise && this._inFlightLoadViewId === viewId) {
      return this._inFlightLoadPromise;
    }

    const runRestore = async () => {
      const startedBatch = this._beginViewRestoreBatch({ startup });
      try {
        const response = await this._loadViewById(viewId);
        if (!response) return;

        console.log('[ViewManagementService] Loading view:', response);

        // Store the active view data for filtering
        this._activeViewData = response;
        const sidebarElement = this._getSidebarElement();
        const viewOptions = response.viewOptions || {};
        const deferredViews = this._deferredViews;
        this._deferredViews = null;
        this._deferredActiveId = null;

        if (viewId === 'default') {
        const defaults = getDefaultViewOptions();
          const restorePayload = {
          projectSelections: this._buildSelections(this._state.projects, null, true),
          teamSelections: this._buildSelections(this._state.teams, null, true),
          selectedStates: [...(this._state.availableFeatureStates || [])],
          resetTaskFilters: true,
        };
        const expansion = this._buildExpansionState({
          expandParentChild: defaults.expandParentChild || false,
          expandRelations: defaults.expandRelations || false,
          expandTeamAllocated: defaults.expandTeamAllocated || false,
        });
        const selectedTaskTypes = this._deriveSelectedTaskTypes(sidebarElement, true);
          this._applyViewRestoreTransaction({
            ...restorePayload,
          ...(deferredViews !== null ? { savedViews: deferredViews } : {}),
          activeViewId: viewId,
          viewOptions: defaults,
          graphType: 'team',
          selectedTaskTypes,
          expansion,
          emitExpansionFilterChange: false,
        });
        this._applyViewRestoreUiEffects(
          sidebarElement,
          this._planViewRestoreUiEffects({
            graphType: 'team',
            selectedTaskTypes,
            expansion,
          })
        );
        } else {
        const restorePayload = {
          projectSelections: this._buildSelections(
            this._state.projects,
            response.selectedProjects,
            false
          ),
          teamSelections: this._buildSelections(this._state.teams, response.selectedTeams, false),
        };
        if (viewOptions.taskFilters) {
          restorePayload.taskFilters = viewOptions.taskFilters;
        }
        if (Array.isArray(viewOptions.selectedFeatureStates)) {
          const savedStates = viewOptions.selectedFeatureStates.filter(Boolean);
          const availableStates = this._state.availableFeatureStates || [];
          const validStates =
            availableStates.length > 0 ?
              savedStates.filter((s) => availableStates.includes(s))
            : savedStates;
          restorePayload.selectedStates = Array.from(new Set(validStates));
        }
        const selectedTaskTypes = this._resolveSelectedTaskTypes(
          viewOptions,
          sidebarElement,
          true
        );
        const expansion = this._extractExpansionState(viewOptions);
        this._applyViewRestoreTransaction({
          ...restorePayload,
          ...(deferredViews !== null ? { savedViews: deferredViews } : {}),
          activeViewId: viewId,
          viewOptions,
          graphType: viewOptions.graphType,
          selectedTaskTypes,
          expansion,
          emitExpansionFilterChange: true,
        });
        this._applyViewRestoreUiEffects(
          sidebarElement,
          this._planViewRestoreUiEffects({
            graphType: viewOptions.graphType,
            selectedTaskTypes,
            expansion,
          })
        );
      }

        await this._restorePluginState(viewOptions);
        if (typeof this._state.applyViewRestoreTransaction !== 'function') {
          this._syncViewState({
            views: deferredViews !== null ? deferredViews : undefined,
            activeId: viewId,
          });
        }
        this._saveLastViewId(viewId);
        // Ensure View menu consumers receive the canonical saved-view list,
        // including the default entry after deferred startup restore.
        this._emitViewsList();
        this._emitViewActivated();
        if (startup) this._startupRestoreCompleted = true;
      } catch (err) {
        console.error('[ViewManagementService] Error loading view:', err);
        if (startup) this._startupRestoreCompleted = false;
        throw err;
      } finally {
        if (startedBatch) this._endViewRestoreBatch();
      }
    };

    const previousRestore = this._inFlightLoadPromise;
    if (previousRestore) {
      try {
        await previousRestore;
      } catch (_err) {
        // Keep restore queue moving even if previous restore failed.
      }
      if (this._inFlightLoadPromise && this._inFlightLoadViewId === viewId) {
        return this._inFlightLoadPromise;
      }
    }

    const currentRestore = runRestore();
    this._inFlightLoadPromise = currentRestore;
    this._inFlightLoadViewId = viewId;
    try {
      return await currentRestore;
    } finally {
      if (this._inFlightLoadPromise === currentRestore) {
        this._inFlightLoadPromise = null;
        this._inFlightLoadViewId = null;
      }
    }
  }

  /**
   * Rename a saved view
   * @param {string} viewId - View ID to rename
   * @param {string} newName - New view name
   * @returns {Promise<void>}
   */
  async renameView(viewId, newName) {
    try {
      const renamed = dataOr(await dataService.renameView(viewId, newName), null);
      if (!renamed) {
        throw new Error('Rename operation failed');
      }
      console.log('[ViewManagementService] Renamed view:', viewId, 'to', newName);

      // Preserve active view if this view is currently active
      const wasActive = this._getActiveViewId() === viewId;

      // Reload views list
      await this.loadViews();

      // Re-emit view activated if it was active to ensure UI updates
      if (wasActive) {
        this._emitViewActivated();
      }
    } catch (err) {
      console.error('[ViewManagementService] Error renaming view:', err);
      throw err;
    }
  }

  /**
   * Delete a saved view
   * @param {string} viewId - View ID to delete
   * @returns {Promise<void>}
   */
  async deleteView(viewId) {
    try {
      const ok = dataOr(await dataService.deleteView(viewId), false);
      if (!ok) {
        throw new Error('Delete operation failed');
      }

      console.log('[ViewManagementService] Deleted view:', viewId);

      // Clear active view if it was deleted
      if (this._getActiveViewId() === viewId) {
        this._syncViewState({ activeId: null });
        this._activeViewData = null;
      }

      // Reload views list
      await this.loadViews();
    } catch (err) {
      console.error('[ViewManagementService] Error deleting view:', err);
      throw err;
    }
  }

  /**
   * Get all views
   * @returns {Array} Array of view metadata
   */
  getViews() {
    return this._getViews();
  }

  /**
   * Get active view ID
   * @returns {string|null}
   */
  getActiveViewId() {
    return this._getActiveViewId();
  }

  /**
   * Clear active view (set back to unsaved state)
   */
  clearActiveView() {
    this._syncViewState({ activeId: null });
    this._activeViewData = null;
    this._emitViewActivated();
  }

  /**
   * Get active view data (full data including filters)
   * @returns {Object|null}
   */
  getActiveViewData() {
    return this._activeViewData;
  }

  /**
   * Emit views list event
   * @private
   */
  _emitViewsList() {
    if (!this._bus) return;
    const views = this._getViews();
    console.log(
      '[ViewManagementService] Emitting views list:',
      views.length,
      'views'
    );
    this._env.events.emitViewsList(this._bus, {
      views,
      activeViewId: this._getActiveViewId(),
      activeViewData: this._activeViewData,
    });
  }

  /**
   * Emit view activated event
   * @private
   */
  _emitViewActivated() {
    if (!this._bus) return;
    const activeViewId = this._getActiveViewId();
    console.log('[ViewManagementService] Emitting view activated:', activeViewId);
    this._env.events.emitViewActivated(this._bus, {
      id: activeViewId,
      data: this._activeViewData,
    });
  }

  /**
   * Save the last active view ID to configured storage
   * @private
   * @param {string} viewId - View ID to save
   */
  _saveLastViewId(viewId) {
    try {
      this._env.storage.setItem(this._lastViewIdStorageKey, viewId);
      console.log('[ViewManagementService] Saved last view ID:', viewId);
    } catch (err) {
      console.warn('[ViewManagementService] Failed to save last view ID:', err);
    }
  }

  /**
   * Get the last active view ID from configured storage
   * @returns {string|null} Last view ID or null if not found
   */
  getLastViewId() {
    try {
      return this._env.storage.getItem(this._lastViewIdStorageKey);
    } catch (err) {
      console.warn('[ViewManagementService] Failed to get last view ID:', err);
    }
    return null;
  }

  async _loadViewById(viewId) {
    if (viewId === 'default') {
      const view = this._getViews().find((v) => v.id === 'default');
      if (!view) {
        console.warn('[ViewManagementService] Default view not found');
        return null;
      }
      return view;
    }
    const view = dataOr(await dataService.getView(viewId), null);
    if (!view) {
      console.warn('[ViewManagementService] View not found:', viewId);
      return null;
    }
    return view;
  }

  _applySelections(items, selectedMap, selectAll, setter) {
    if (!items || typeof setter !== 'function') return;
    setter(this._buildSelections(items, selectedMap, selectAll));
  }

  _beginViewRestoreBatch(options = {}) {
    return !!this._state?.beginViewRestoreBatch?.(options);
  }

  _endViewRestoreBatch() {
    return !!this._state?.endViewRestoreBatch?.();
  }

  _buildSelections(items, selectedMap, selectAll) {
    if (!items) return {};
    const selections = {};
    items.forEach((item) => {
      selections[item.id] = selectAll ? true : selectedMap?.[item.id] === true;
    });
    return selections;
  }

  _applyViewSelectionRestore(payload) {
    if (typeof this._state.applyViewSelectionRestore === 'function') {
      this._state.applyViewSelectionRestore(payload);
      return;
    }

    if (payload?.projectSelections) {
      this._state.setProjectsSelectedBulk(payload.projectSelections);
    }
    if (payload?.teamSelections) {
      this._state.setTeamsSelectedBulk(payload.teamSelections);
    }
    if (Array.isArray(payload?.selectedStates)) {
      this._state.setSelectedStates(payload.selectedStates);
    }
    if (payload?.resetTaskFilters) {
      this._state.taskFilterService?.resetFilters?.();
    } else if (payload?.taskFilters) {
      this._state.taskFilterService?.restoreFilters?.(payload.taskFilters);
    }
  }

  _deriveSelectedTaskTypes(sidebarElement, updateTaskTypes) {
    if (!sidebarElement || !updateTaskTypes) return null;
    const availableTypes = sidebarElement.availableTaskTypes || [];
    // Startup can apply views before sidebar task types are initialized.
    // Avoid committing an empty task-type selection in that case.
    if (!Array.isArray(availableTypes) || availableTypes.length === 0) return null;
    return availableTypes.filter((t) => this._viewService.isTypeVisible(t));
  }

  _resolveSelectedTaskTypes(viewOptions, sidebarElement, updateTaskTypes) {
    if (Array.isArray(viewOptions?.selectedTaskTypes)) {
      return Array.from(new Set(viewOptions.selectedTaskTypes.filter(Boolean)));
    }
    return this._deriveSelectedTaskTypes(sidebarElement, updateTaskTypes);
  }

  _extractExpansionState(viewOptions) {
    const hasExpansionSetting =
      typeof viewOptions.expandParentChild !== 'undefined' ||
      typeof viewOptions.expandRelations !== 'undefined' ||
      typeof viewOptions.expandTeamAllocated !== 'undefined';
    if (!hasExpansionSetting) return null;

    return this._buildExpansionState(viewOptions);
  }

  _buildExpansionState(viewOptions) {
    return {
      expandParentChild: viewOptions.expandParentChild || false,
      expandRelations: viewOptions.expandRelations || false,
      expandTeamAllocated: viewOptions.expandTeamAllocated || false,
    };
  }

  _applyViewOptionsRestore(payload) {
    const expansion = payload?.expansion || null;
    if (typeof this._state.applyViewOptionsRestore === 'function') {
      this._state.applyViewOptionsRestore(payload);
      return;
    }

    if (payload?.viewOptions) {
      this._viewService.restoreView(payload.viewOptions);
    }
    if (payload?.graphType) {
      this._viewService.setCapacityViewMode(payload.graphType);
    }
    if (Array.isArray(payload?.selectedTaskTypes)) {
      this._env.events.emitFilterChanged(this._bus, {
        selectedTaskTypes: payload.selectedTaskTypes,
      });
    }
    if (expansion) {
      this._state.setExpansionState(expansion);
      if (payload?.emitExpansionFilterChange) {
        this._env.events.emitFilterChanged(this._bus, {
          expansion: {
            parentChild: expansion.expandParentChild,
            relations: expansion.expandRelations,
            teamAllocated: expansion.expandTeamAllocated,
          },
        });
      }
    }
  }

  _applyViewRestoreTransaction(payload) {
    if (typeof this._state.applyViewRestoreTransaction === 'function') {
      this._state.applyViewRestoreTransaction(payload);
      return;
    }
    this._applyViewSelectionRestore(payload);
    this._applyViewOptionsRestore(payload);
  }

  _planViewRestoreUiEffects(payload) {
    if (typeof this._state.planViewRestoreUiEffects === 'function') {
      return this._state.planViewRestoreUiEffects(payload) || [];
    }

    const effects = [];
    if (Array.isArray(payload?.selectedTaskTypes)) {
      effects.push({
        type: 'setSelectedTaskTypes',
        selectedTaskTypes: payload.selectedTaskTypes,
      });
    }
    if (payload?.graphType) {
      effects.push({
        type: 'setGraphType',
        graphType: payload.graphType,
      });
    }
    if (payload?.expansion) {
      effects.push({
        type: 'setExpansionState',
        expansion: payload.expansion,
      });
      effects.push({ type: 'recomputeDataFunnel' });
    }
    effects.push({ type: 'requestSidebarUpdate' });
    return effects;
  }

  _applyViewRestoreUiEffects(sidebarElement, effects) {
    if (!sidebarElement || !Array.isArray(effects)) return;

    for (const effect of effects) {
      if (!effect || typeof effect !== 'object') continue;
      switch (effect.type) {
        case 'setSelectedTaskTypes':
          this._env.ui.setSelectedTaskTypes(sidebarElement, effect.selectedTaskTypes || []);
          break;
        case 'setGraphType':
          this._env.ui.setGraphType(sidebarElement, effect.graphType);
          break;
        case 'setExpansionState':
          this._env.ui.setExpansionState(sidebarElement, effect.expansion || {});
          break;
        case 'recomputeDataFunnel':
          this._env.ui.recomputeDataFunnel(sidebarElement);
          break;
        case 'requestSidebarUpdate':
          this._env.ui.requestSidebarUpdate(sidebarElement);
          break;
        default:
          break;
      }
    }
  }

  async _restorePluginState(viewOptions) {
    const pluginState = viewOptions?.pluginState || {};
    if (typeof this._state?.applyViewPluginStateRestore === 'function') {
      await this._state.applyViewPluginStateRestore({ pluginState });
      return;
    }

    if (!this._state?.pluginStateService?.restoreFromView) return;
    try {
      await this._state.pluginStateService.restoreFromView(pluginState);
    } catch (e) {
      console.warn('[ViewManagementService] Failed to restore plugin state from view', e);
    }
  }

  /**
   * Restore the last active view from configured storage
   * Should be called after views are loaded and projects/teams are available
   * @returns {Promise<boolean>} True if a view was restored, false otherwise
   */
  async restoreLastView(options = {}) {
    const startup = !!options.startup;
    if (startup && this._startupRestorePromise) {
      return this._startupRestorePromise;
    }

    const runRestore = async () => {
      try {
      if (startup && this._startupRestoreCompleted) {
        return true;
      }

      const lastViewId = this.getLastViewId();
      const targetViewId = lastViewId || 'default';
      if (this._getActiveViewId() === targetViewId && this._activeViewData?.id === targetViewId) {
        if (startup) this._startupRestoreCompleted = true;
        return true;
      }

      if (!lastViewId) {
        console.log(
          '[ViewManagementService] No last view ID found, activating default view'
        );
        await this.loadAndApplyView('default', { startup });
        if (startup) this._startupRestoreCompleted = true;
        return true;
      }

      // Check if the view exists
      const viewExists = this._getViews().some((v) => v.id === lastViewId);

      if (viewExists) {
        console.log('[ViewManagementService] Restoring last view:', lastViewId);
        await this.loadAndApplyView(lastViewId, { startup });
        if (startup) this._startupRestoreCompleted = true;
        return true;
      } else {
        console.warn(
          '[ViewManagementService] Last view not found, activating default view'
        );
        await this.loadAndApplyView('default', { startup });
        if (startup) this._startupRestoreCompleted = true;
        return true;
      }
    } catch (err) {
      console.error('[ViewManagementService] Error restoring last view:', err);
      // Fall back to default view on error
      try {
        await this.loadAndApplyView('default', { startup: !!options?.startup });
        if (options?.startup) this._startupRestoreCompleted = true;
      } catch (e) {
        console.error('[ViewManagementService] Failed to load default view:', e);
      }
      return false;
      }
    };

    if (!startup) {
      return runRestore();
    }

    const promise = runRestore();
    this._startupRestorePromise = promise;
    try {
      return await promise;
    } finally {
      if (this._startupRestorePromise === promise) {
        this._startupRestorePromise = null;
      }
    }
  }

  /**
   * Capture current state of the application for saving as a view
   * @returns {Object} State snapshot containing projects, teams, and view options
   * @private
   */
  _captureCurrentState() {
    const sidebarElement = this._getSidebarElement();
    const snapshot = {
      projects: {},
      teams: {},
      viewOptions: this._viewService.captureCurrentView(),
    };

    // Capture selected feature states (state filter)
    snapshot.viewOptions.selectedFeatureStates = this._state.selectedFeatureStates || [];

    // Capture selected task types (from sidebar element) if present
    if (sidebarElement && sidebarElement.selectedTaskTypes) {
      snapshot.viewOptions.selectedTaskTypes = Array.from(
        sidebarElement.selectedTaskTypes || []
      );
    }

    // Capture graph type (from sidebar element) if present
    if (sidebarElement && sidebarElement._graphType) {
      snapshot.viewOptions.graphType = sidebarElement._graphType;
    }

    // Capture task filters
    if (this._state.taskFilterService) {
      snapshot.viewOptions.taskFilters = this._state.taskFilterService.getFilters();
    }

    // Capture expansion options (from sidebar element) if present
    if (sidebarElement) {
      snapshot.viewOptions.expandParentChild = sidebarElement.expandParentChild || false;
      snapshot.viewOptions.expandRelations = sidebarElement.expandRelations || false;
      snapshot.viewOptions.expandTeamAllocated =
        sidebarElement.expandTeamAllocated || false;
    }

    // Capture project selections
    if (this._state.projects) {
      this._state.projects.forEach((project) => {
        snapshot.projects[project.id] = project.selected;
      });
    }

    // Capture team selections
    if (this._state.teams) {
      this._state.teams.forEach((team) => {
        snapshot.teams[team.id] = team.selected;
      });
    }

    // Capture plugin state for views if available
    try {
      if (this._state && this._state.pluginStateService) {
        const pluginMap = this._state.pluginStateService.captureForView();
        if (pluginMap && Object.keys(pluginMap).length > 0) {
          snapshot.viewOptions = snapshot.viewOptions || {};
          snapshot.viewOptions.pluginState = pluginMap;
        }
      }
    } catch (e) {
      console.warn('[ViewManagementService] Failed to capture plugin state for view', e);
    }

    return snapshot;
  }
}
