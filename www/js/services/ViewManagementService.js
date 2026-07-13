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
  ui: {
    getSidebarElement: () => null,
  },
};

export class ViewManagementService {
  constructor(bus, state, viewService, env = {}) {
    this._bus = bus;
    this._state = state;
    this._viewService = viewService;
    this._views = []; // List of saved views (metadata)
    this._activeViewId = null; // Currently active view ID
    this._activeViewData = null; // Full data of currently active view (for filtering)
    this._lastViewIdStorageKey = 'az_planner:last_view_id';
    this.setEnvironment(env);
  }

  setEnvironment(env = {}) {
    this._env = {
      storage: env.storage || DEFAULT_VIEW_MGMT_ENV.storage,
      ui: env.ui || DEFAULT_VIEW_MGMT_ENV.ui,
    };
  }

  _getSidebarElement() {
    return this._env?.ui?.getSidebarElement?.() || null;
  }

  /**
   * Initialize default view (readonly view that shows all)
   */
  initDefaultView() {
    const DEFAULT_ID = 'default';
    const existing = this._views.find((v) => v.id === DEFAULT_ID);

    if (!existing) {
      const defaultView = {
        id: DEFAULT_ID,
        name: 'Default View',
        readonly: true,
        // Default view has no filters - shows everything
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {},
      };
      this._views.unshift(defaultView); // Add at beginning
      // Only set activeViewId to default if no view is currently active
      if (!this._activeViewId) {
        this._activeViewId = DEFAULT_ID;
      }
    }
  }

  /**
   * Load all views from backend
   * @returns {Promise<Array>} Array of view metadata
   */
  async loadViews() {
    try {
      const userViews = dataOr(await dataService.listViews(), []) || [];
      console.log('[ViewManagementService] Loaded user views:', userViews);

      // Combine default view + user views
      this._views = [];
      this.initDefaultView();
      this._views.push(...userViews);

      console.log('[ViewManagementService] Total views:', this._views);
      this._emitViewsList();
      return this._views;
    } catch (err) {
      console.error('[ViewManagementService] Error loading views:', err);
      this._views = [];
      this.initDefaultView();
      this._emitViewsList();
      return this._views;
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
      this._activeViewId = response.id;
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
  async loadAndApplyView(viewId) {
    try {
      const response = await this._loadViewById(viewId);
      if (!response) return;

      console.log('[ViewManagementService] Loading view:', response);

      // Store the active view data for filtering
      this._activeViewData = response;
      const sidebarElement = this._getSidebarElement();
      const viewOptions = response.viewOptions || {};

      if (viewId === 'default') {
        const defaults = getDefaultViewOptions();
        this._viewService.restoreView(defaults);
        this._applySelections(this._state.projects, null, true, (s) =>
          this._state.setProjectsSelectedBulk(s)
        );
        this._applySelections(this._state.teams, null, true, (s) =>
          this._state.setTeamsSelectedBulk(s)
        );
        this._state.setSelectedStates([...(this._state.availableFeatureStates || [])]);
        this._state.taskFilterService?.resetFilters();
        this._applyExpansionState({
          expandParentChild: defaults.expandParentChild || false,
          expandRelations: defaults.expandRelations || false,
          expandTeamAllocated: defaults.expandTeamAllocated || false,
        }, sidebarElement, false);
        this._syncSidebarViewState(sidebarElement, {
          graphType: 'team',
          updateTaskTypes: true,
        });
      } else {
        this._applySelections(this._state.projects, response.selectedProjects, false, (s) =>
          this._state.setProjectsSelectedBulk(s)
        );
        this._applySelections(this._state.teams, response.selectedTeams, false, (s) =>
          this._state.setTeamsSelectedBulk(s)
        );
        this._viewService.restoreView(viewOptions);
        if (viewOptions.taskFilters) {
          this._state.taskFilterService?.restoreFilters(viewOptions.taskFilters);
        }
        if (Array.isArray(viewOptions.selectedFeatureStates)) {
          const availableStates = this._state.availableFeatureStates || [];
          const validStates = viewOptions.selectedFeatureStates.filter((s) => availableStates.includes(s));
          this._state.setSelectedStates(validStates);
        }
        this._syncSidebarViewState(sidebarElement, {
          graphType: viewOptions.graphType,
          updateTaskTypes: true,
        });
        this._applyExpansionState(viewOptions, sidebarElement, true);
      }

      await this._restorePluginState(viewOptions);

      this._activeViewId = viewId;
      this._saveLastViewId(viewId);
      this._emitViewActivated();
    } catch (err) {
      console.error('[ViewManagementService] Error loading view:', err);
      throw err;
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
      const wasActive = this._activeViewId === viewId;

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
      if (this._activeViewId === viewId) {
        this._activeViewId = null;
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
    return this._views;
  }

  /**
   * Get active view ID
   * @returns {string|null}
   */
  getActiveViewId() {
    return this._activeViewId;
  }

  /**
   * Clear active view (set back to unsaved state)
   */
  clearActiveView() {
    this._activeViewId = null;
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
    console.log(
      '[ViewManagementService] Emitting views list:',
      this._views.length,
      'views'
    );
    this._bus.emit(ViewManagementEvents.LIST, {
      views: this._views,
      activeViewId: this._activeViewId,
      activeViewData: this._activeViewData,
    });
  }

  /**
   * Emit view activated event
   * @private
   */
  _emitViewActivated() {
    if (!this._bus) return;
    console.log('[ViewManagementService] Emitting view activated:', this._activeViewId);
    this._bus.emit(ViewManagementEvents.ACTIVATED, {
      id: this._activeViewId,
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
      const view = this._views.find((v) => v.id === 'default');
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
    const selections = {};
    items.forEach((item) => {
      selections[item.id] = selectAll ? true : selectedMap?.[item.id] === true;
    });
    setter(selections);
  }

  _syncSidebarViewState(sidebarElement, { graphType, updateTaskTypes }) {
    if (!sidebarElement) return;
    if (updateTaskTypes) {
      const availableTypes = sidebarElement.availableTaskTypes || [];
      sidebarElement.selectedTaskTypes = new Set(
        availableTypes.filter((t) => this._viewService.isTypeVisible(t))
      );
      this._bus.emit(FilterEvents.CHANGED, {
        selectedTaskTypes: Array.from(sidebarElement.selectedTaskTypes),
      });
    }
    if (graphType && typeof sidebarElement._graphType !== 'undefined') {
      sidebarElement._graphType = graphType;
      this._viewService.setCapacityViewMode(graphType);
    }
    if (typeof sidebarElement.requestUpdate === 'function') {
      sidebarElement.requestUpdate();
    }
  }

  _applyExpansionState(viewOptions, sidebarElement, emitFilterChange) {
    const hasExpansionSetting =
      typeof viewOptions.expandParentChild !== 'undefined' ||
      typeof viewOptions.expandRelations !== 'undefined' ||
      typeof viewOptions.expandTeamAllocated !== 'undefined';
    if (!hasExpansionSetting) return;

    const expansion = {
      expandParentChild: viewOptions.expandParentChild || false,
      expandRelations: viewOptions.expandRelations || false,
      expandTeamAllocated: viewOptions.expandTeamAllocated || false,
    };
    this._state.setExpansionState(expansion);

    if (sidebarElement) {
      sidebarElement.expandParentChild = expansion.expandParentChild;
      sidebarElement.expandRelations = expansion.expandRelations;
      sidebarElement.expandTeamAllocated = expansion.expandTeamAllocated;
      if (typeof sidebarElement._recomputeDataFunnel === 'function') {
        sidebarElement._recomputeDataFunnel();
      }
      if (typeof sidebarElement.requestUpdate === 'function') {
        sidebarElement.requestUpdate();
      }
    }

    if (emitFilterChange) {
      this._bus.emit(FilterEvents.CHANGED, {
        expansion: {
          parentChild: expansion.expandParentChild,
          relations: expansion.expandRelations,
          teamAllocated: expansion.expandTeamAllocated,
        },
      });
    }
  }

  async _restorePluginState(viewOptions) {
    if (!this._state?.pluginStateService?.restoreFromView) return;
    try {
      await this._state.pluginStateService.restoreFromView(viewOptions?.pluginState || {});
    } catch (e) {
      console.warn('[ViewManagementService] Failed to restore plugin state from view', e);
    }
  }

  /**
   * Restore the last active view from configured storage
   * Should be called after views are loaded and projects/teams are available
   * @returns {Promise<boolean>} True if a view was restored, false otherwise
   */
  async restoreLastView() {
    try {
      const lastViewId = this.getLastViewId();

      if (!lastViewId) {
        console.log(
          '[ViewManagementService] No last view ID found, activating default view'
        );
        await this.loadAndApplyView('default');
        return true;
      }

      // Check if the view exists
      const viewExists = this._views.some((v) => v.id === lastViewId);

      if (viewExists) {
        console.log('[ViewManagementService] Restoring last view:', lastViewId);
        await this.loadAndApplyView(lastViewId);
        return true;
      } else {
        console.warn(
          '[ViewManagementService] Last view not found, activating default view'
        );
        await this.loadAndApplyView('default');
        return true;
      }
    } catch (err) {
      console.error('[ViewManagementService] Error restoring last view:', err);
      // Fall back to default view on error
      try {
        await this.loadAndApplyView('default');
      } catch (e) {
        console.error('[ViewManagementService] Failed to load default view:', e);
      }
      return false;
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
