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
import { ViewManagementEvents } from '../core/EventRegistry.js';

export class ViewManagementService {
  constructor(bus, state, viewService, sidebarPersistenceService) {
    this._bus = bus;
    this._state = state;
    this._viewService = viewService;
    this._sidebarPersistenceService = sidebarPersistenceService;
    this._views = []; // List of saved views (metadata)
    this._activeViewId = null; // Currently active view ID
    this._activeViewData = null; // Full data of currently active view (for filtering)
  }

  /**
   * Initialize default view (readonly view that shows all)
   */
  initDefaultView() {
    const DEFAULT_ID = 'default';
    const existing = this._views.find(v => v.id === DEFAULT_ID);
    
    if (!existing) {
      const defaultView = {
        id: DEFAULT_ID,
        name: 'Default View',
        readonly: true,
        // Default view has no filters - shows everything
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {}
      };
      this._views.unshift(defaultView); // Add at beginning
      this._activeViewId = DEFAULT_ID;
    }
  }

  /**
   * Load all views from backend
   * @returns {Promise<Array>} Array of view metadata
   */
  async loadViews() {
    try {
      const response = await dataService.listViews();
      const userViews = response || [];
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
      // Capture current sidebar state (projects, teams, view options)
      const sidebarElement = document.querySelector('app-sidebar');
      const currentState = this._sidebarPersistenceService.captureSidebarState(
        this._state,
        this._viewService,
        sidebarElement
      );

      const viewData = {
        id: viewId,
        name: name,
        selectedProjects: currentState.projects || {},
        selectedTeams: currentState.teams || {},
        viewOptions: currentState.viewOptions || {}
      };

      const response = await dataService.saveView(viewData);

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
      let response;
      
      // Handle default view specially
      if (viewId === 'default') {
        response = this._views.find(v => v.id === 'default');
        if (!response) {
          console.warn('[ViewManagementService] Default view not found');
          return;
        }
      } else {
        response = await dataService.getView(viewId);
        if (!response) {
          console.warn('[ViewManagementService] View not found:', viewId);
          return;
        }
      }

      console.log('[ViewManagementService] Loading view:', response);

      // Store the active view data for filtering
      this._activeViewData = response;

      // For default view, select all projects and teams
      if (viewId === 'default') {
        if (this._state.projects) {
          this._state.projects.forEach(project => {
            if (!project.selected) {
              this._state.setProjectSelected(project.id, true);
            }
          });
        }
        if (this._state.teams) {
          this._state.teams.forEach(team => {
            if (!team.selected) {
              this._state.setTeamSelected(team.id, true);
            }
          });
        }
      } else {
        // For custom views, apply specific selections
        // First, deselect all projects/teams
        if (this._state.projects) {
          this._state.projects.forEach(project => {
            const shouldBeSelected = response.selectedProjects?.[project.id] === true;
            if (project.selected !== shouldBeSelected) {
              this._state.setProjectSelected(project.id, shouldBeSelected);
            }
          });
        }

        if (this._state.teams) {
          this._state.teams.forEach(team => {
            const shouldBeSelected = response.selectedTeams?.[team.id] === true;
            if (team.selected !== shouldBeSelected) {
              this._state.setTeamSelected(team.id, shouldBeSelected);
            }
          });
        }

        // Apply view options
        if (response.viewOptions) {
          this._viewService.restoreView(response.viewOptions);
          
          // Restore state filters if present
          if (response.viewOptions.selectedFeatureStates && Array.isArray(response.viewOptions.selectedFeatureStates)) {
            // Set the state filter to the saved selection
            const availableStates = this._state.availableFeatureStates || [];
            const savedStates = response.viewOptions.selectedFeatureStates;
            
            // Filter to only include states that are currently available
            const validStates = savedStates.filter(stateName => availableStates.includes(stateName));
            
            // Set the selected states (this will emit events)
            this._state._stateFilterService.setSelectedStates(validStates);
          }
        }
      }

      this._activeViewId = viewId;
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
      await dataService.renameView(viewId, newName);
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
      const ok = await dataService.deleteView(viewId);
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
    console.log('[ViewManagementService] Emitting views list:', this._views.length, 'views');
    this._bus.emit(ViewManagementEvents.LIST, {
      views: this._views,
      activeViewId: this._activeViewId,
      activeViewData: this._activeViewData
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
      viewId: this._activeViewId,
      activeViewData: this._activeViewData
    });
  }
}
