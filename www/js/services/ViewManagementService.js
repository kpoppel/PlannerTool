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
import { getDefaultViewOptions } from '../config/viewDefaults.js';

export class ViewManagementService {
  constructor(bus, state, viewService) {
    this._bus = bus;
    this._state = state;
    this._viewService = viewService;
    this._views = []; // List of saved views (metadata)
    this._activeViewId = null; // Currently active view ID
    this._activeViewData = null; // Full data of currently active view (for filtering)
    this._lastViewIdStorageKey = 'az_planner:last_view_id';
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
      // Capture current state (projects, teams, view options)
      const currentState = this._captureCurrentState();

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

      // For default view, select all projects and teams AND reset all view options to defaults
      if (viewId === 'default') {
        // Reset view options to defaults
        const defaults = getDefaultViewOptions();
        this._viewService.restoreView(defaults);
        
        // Select all projects
        if (this._state.projects) {
          const projectSelections = {};
          this._state.projects.forEach(project => {
            projectSelections[project.id] = true;
          });
          this._state.setProjectsSelectedBulk(projectSelections);
        }
        
        // Select all teams
        if (this._state.teams) {
          const teamSelections = {};
          this._state.teams.forEach(team => {
            teamSelections[team.id] = true;
          });
          this._state.setTeamsSelectedBulk(teamSelections);
        }
        
        // Select all available states
        if (this._state._stateFilterService) {
          const allStates = this._state.availableFeatureStates || [];
          this._state._stateFilterService.setSelectedStates([...allStates]);
        }
        
        // Reset task filters (schedule, allocation, hierarchy, relations)
        if (this._state.taskFilterService) {
          this._state.taskFilterService.resetFilters();
        }
        
        // Reset expansion options
        this._state.setExpansionState({
          expandParentChild: defaults.expandParentChild || false,
          expandRelations: defaults.expandRelations || false,
          expandTeamAllocated: defaults.expandTeamAllocated || false
        });

        // Reset sidebar-local properties (task types and graph type)
        const sidebarElement = document.querySelector('app-sidebar');
        if (sidebarElement) {
          // Reset task types to all available types
          if (sidebarElement.availableTaskTypes && Array.isArray(sidebarElement.availableTaskTypes)) {
            sidebarElement.selectedTaskTypes = new Set(sidebarElement.availableTaskTypes);
            // Emit event to notify other components
            this._bus.emit('filter:changed', { 
              selectedTaskTypes: Array.from(sidebarElement.selectedTaskTypes) 
            });
          }
          
          // Reset graph type to default
          if (typeof sidebarElement._graphType !== 'undefined') {
            sidebarElement._graphType = 'team';
            // Sync with ViewService
            this._viewService.setCapacityViewMode('team');
          }
          
          // Reset expansion options to defaults
          sidebarElement.expandParentChild = defaults.expandParentChild || false;
          sidebarElement.expandRelations = defaults.expandRelations || false;
          sidebarElement.expandTeamAllocated = defaults.expandTeamAllocated || false;
          
          // Request update to reflect changes
          if (typeof sidebarElement.requestUpdate === 'function') {
            sidebarElement.requestUpdate();
          }
        }
      } else {
        // For custom views, apply specific selections
        if (this._state.projects) {
          const projectSelections = {};
          this._state.projects.forEach(project => {
            projectSelections[project.id] = response.selectedProjects?.[project.id] === true;
          });
          this._state.setProjectsSelectedBulk(projectSelections);
        }

        if (this._state.teams) {
          const teamSelections = {};
          this._state.teams.forEach(team => {
            teamSelections[team.id] = response.selectedTeams?.[team.id] === true;
          });
          this._state.setTeamsSelectedBulk(teamSelections);
        }

        // Apply view options
        if (response.viewOptions) {
          this._viewService.restoreView(response.viewOptions);
          
          // Restore task filters if present
          if (response.viewOptions.taskFilters && this._state.taskFilterService) {
            this._state.taskFilterService.restoreFilters(response.viewOptions.taskFilters);
          }
          
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

          // Restore sidebar-local properties (task types and graph type)
          const sidebarElement = document.querySelector('app-sidebar');
          if (sidebarElement) {
            // Restore task types if saved
            if (response.viewOptions.selectedTaskTypes && Array.isArray(response.viewOptions.selectedTaskTypes)) {
              const availableTypes = sidebarElement.availableTaskTypes || [];
              const savedTypes = response.viewOptions.selectedTaskTypes;
              const validTypes = savedTypes.filter(t => availableTypes.includes(t));
              
              if (validTypes.length > 0) {
                sidebarElement.selectedTaskTypes = new Set(validTypes);
              } else {
                // If no valid types, default to all available
                sidebarElement.selectedTaskTypes = new Set(availableTypes);
              }
              
              this._bus.emit('filter:changed', { 
                selectedTaskTypes: Array.from(sidebarElement.selectedTaskTypes) 
              });
            }
            
            // Restore graph type if saved
            if (response.viewOptions.graphType) {
              sidebarElement._graphType = response.viewOptions.graphType;
              // Sync with ViewService
              this._viewService.setCapacityViewMode(response.viewOptions.graphType);
            }
            
            // Restore expansion options if saved
            let expansionChanged = false;
            if (typeof response.viewOptions.expandParentChild !== 'undefined') {
              sidebarElement.expandParentChild = response.viewOptions.expandParentChild;
              expansionChanged = true;
            }
            if (typeof response.viewOptions.expandRelations !== 'undefined') {
              sidebarElement.expandRelations = response.viewOptions.expandRelations;
              expansionChanged = true;
            }
            if (typeof response.viewOptions.expandTeamAllocated !== 'undefined') {
              sidebarElement.expandTeamAllocated = response.viewOptions.expandTeamAllocated;
              expansionChanged = true;
            }
            
            // Sync expansion state to State service and trigger updates
            if (expansionChanged) {
              this._state.setExpansionState({
                expandParentChild: sidebarElement.expandParentChild,
                expandRelations: sidebarElement.expandRelations,
                expandTeamAllocated: sidebarElement.expandTeamAllocated
              });
              
              // Trigger data funnel recomputation
              if (typeof sidebarElement._recomputeDataFunnel === 'function') {
                sidebarElement._recomputeDataFunnel();
              }
              
              // Emit filter change event so the board updates
              this._bus.emit('filter:changed', { 
                expansion: { 
                  parentChild: sidebarElement.expandParentChild, 
                  relations: sidebarElement.expandRelations, 
                  teamAllocated: sidebarElement.expandTeamAllocated 
                } 
              });
            }
            
            // Request update to reflect changes
            if (typeof sidebarElement.requestUpdate === 'function') {
              sidebarElement.requestUpdate();
            }
          }
        }
      }

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
      id: this._activeViewId,
      viewId: this._activeViewId,  // For backward compatibility
      data: this._activeViewData,
      activeViewData: this._activeViewData  // For backward compatibility
    });
  }

  /**
   * Save the last active view ID to localStorage
   * @private
   * @param {string} viewId - View ID to save
   */
  _saveLastViewId(viewId) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this._lastViewIdStorageKey, viewId);
        console.log('[ViewManagementService] Saved last view ID:', viewId);
      }
    } catch (err) {
      console.warn('[ViewManagementService] Failed to save last view ID:', err);
    }
  }

  /**
   * Get the last active view ID from localStorage
   * @returns {string|null} Last view ID or null if not found
   */
  getLastViewId() {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(this._lastViewIdStorageKey);
      }
    } catch (err) {
      console.warn('[ViewManagementService] Failed to get last view ID:', err);
    }
    return null;
  }

  /**
   * Restore the last active view from localStorage
   * Should be called after views are loaded and projects/teams are available
   * @returns {Promise<boolean>} True if a view was restored, false otherwise
   */
  async restoreLastView() {
    try {
      const lastViewId = this.getLastViewId();
      
      if (!lastViewId) {
        console.log('[ViewManagementService] No last view ID found, activating default view');
        await this.loadAndApplyView('default');
        return true;
      }
      
      // Check if the view exists
      const viewExists = this._views.some(v => v.id === lastViewId);
      
      if (viewExists) {
        console.log('[ViewManagementService] Restoring last view:', lastViewId);
        await this.loadAndApplyView(lastViewId);
        return true;
      } else {
        console.warn('[ViewManagementService] Last view not found, activating default view');
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
    const sidebarElement = document.querySelector('app-sidebar');
    const snapshot = {
      projects: {},
      teams: {},
      viewOptions: this._viewService.captureCurrentView()
    };

    // Capture selected feature states (state filter)
    if (this._state._stateFilterService) {
      snapshot.viewOptions.selectedFeatureStates = this._state._stateFilterService.getSelectedStates();
    }

    // Capture selected task types (from sidebar element) if present
    if (sidebarElement && sidebarElement.selectedTaskTypes) {
      try {
        snapshot.viewOptions.selectedTaskTypes = Array.from(sidebarElement.selectedTaskTypes || []);
      } catch (e) { /* ignore */ }
    }

    // Capture graph type (from sidebar element) if present
    if (sidebarElement && sidebarElement._graphType) {
      try {
        snapshot.viewOptions.graphType = sidebarElement._graphType;
      } catch (e) { /* ignore */ }
    }

    // Capture task filters
    if (this._state.taskFilterService) {
      snapshot.viewOptions.taskFilters = this._state.taskFilterService.getFilters();
    }

    // Capture expansion options (from sidebar element) if present
    if (sidebarElement) {
      try {
        snapshot.viewOptions.expandParentChild = sidebarElement.expandParentChild || false;
        snapshot.viewOptions.expandRelations = sidebarElement.expandRelations || false;
        snapshot.viewOptions.expandTeamAllocated = sidebarElement.expandTeamAllocated || false;
      } catch (e) { /* ignore */ }
    }

    // Capture project selections
    if (this._state.projects) {
      this._state.projects.forEach(project => {
        snapshot.projects[project.id] = project.selected;
      });
    }

    // Capture team selections
    if (this._state.teams) {
      this._state.teams.forEach(team => {
        snapshot.teams[team.id] = team.selected;
      });
    }

    return snapshot;
  }
}
