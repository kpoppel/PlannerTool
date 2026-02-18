/**
 * SidebarPersistenceService
 * Manages persistence of sidebar state (projects, teams, view options, section collapse states)
 * across browser sessions using localStorage.
 */

export class SidebarPersistenceService {
  /**
   * @param {Object} dataService - DataService instance for localStorage access
   */
  constructor(dataService) {
    this._dataService = dataService;
    this._storageKey = 'sidebar.state';
    this._saveDebounceTimeout = null;
    this._saveDebounceMs = 500; // Debounce saves to avoid excessive writes
  }

  /**
   * Capture current sidebar state including projects, teams, view options, and section collapse states
   * @param {Object} state - State service instance
   * @param {Object} viewService - ViewService instance
   * @param {HTMLElement} sidebarElement - Sidebar DOM element
   * @returns {Object} Sidebar state snapshot
   */
  captureSidebarState(state, viewService, sidebarElement) {
    const sidebarState = {
      projects: {},
      teams: {},
      viewOptions: viewService.captureCurrentView(),
      sectionStates: {}
    };

    // Capture selected feature states (state filter)
    if (state._stateFilterService) {
      sidebarState.viewOptions.selectedFeatureStates = state._stateFilterService.getSelectedStates();
    }

    // Capture project selections
    if (state.projects) {
      state.projects.forEach(project => {
        sidebarState.projects[project.id] = project.selected;
      });
    }

    // Capture team selections
    if (state.teams) {
      state.teams.forEach(team => {
        sidebarState.teams[team.id] = team.selected;
      });
    }

    // Capture section collapse states
    if (sidebarElement) {
      const sections = [
        'viewOptionsSection',
        'projectsSection',
        'teamsSection',
        'scenariosSection',
        'toolsSection'
      ];

      sections.forEach(sectionId => {
        const section = sidebarElement.querySelector(`#${sectionId}`);
        if (section) {
          const contentWrapper = section.children[1];
          if (contentWrapper) {
            sidebarState.sectionStates[sectionId] = 
              contentWrapper.classList.contains('sidebar-section-collapsed');
          }
        }
      });
    }

    return sidebarState;
  }

  /**
   * Restore sidebar state from localStorage
   * @param {Object} state - State service instance
   * @param {Object} viewService - ViewService instance
   * @param {HTMLElement} sidebarElement - Sidebar DOM element
   * @returns {boolean} True if state was restored, false if no saved state found
   */
  async restoreSidebarState(state, viewService, sidebarElement) {
    try {
      const savedState = await this._dataService.getLocalPref(this._storageKey);
      if (!savedState) {
        console.debug('[SidebarPersistenceService] No saved state found');
        return false;
      }

      console.debug('[SidebarPersistenceService] Restoring sidebar state:', savedState);

      // Restore project selections
      if (savedState.projects && state.projects) {
        state.projects.forEach(project => {
          const savedSelection = savedState.projects[project.id];
          if (typeof savedSelection !== 'undefined' && project.selected !== savedSelection) {
            state.setProjectSelected(project.id, savedSelection);
          }
        });
      }

      // Restore team selections
      if (savedState.teams && state.teams) {
        state.teams.forEach(team => {
          const savedSelection = savedState.teams[team.id];
          if (typeof savedSelection !== 'undefined' && team.selected !== savedSelection) {
            state.setTeamSelected(team.id, savedSelection);
          }
        });
      }

      // Restore view options
      if (savedState.viewOptions) {
        viewService.restoreView(savedState.viewOptions);
        
        // Restore state filters if present
        if (savedState.viewOptions.selectedFeatureStates && Array.isArray(savedState.viewOptions.selectedFeatureStates)) {
          const availableStates = state.availableFeatureStates || [];
          const savedStates = savedState.viewOptions.selectedFeatureStates;
          
          // Filter to only include states that are currently available
          const validStates = savedStates.filter(stateName => availableStates.includes(stateName));
          
          // Set the selected states (this will emit events)
          if (state._stateFilterService) {
            state._stateFilterService.setSelectedStates(validStates);
          }
        }
      }

      // Restore section collapse states
      if (savedState.sectionStates && sidebarElement) {
        Object.keys(savedState.sectionStates).forEach(sectionId => {
          const section = sidebarElement.querySelector(`#${sectionId}`);
          if (section) {
            const contentWrapper = section.children[1];
            const chevron = section.querySelector('.sidebar-chevron');
            const shouldBeCollapsed = savedState.sectionStates[sectionId];

            if (contentWrapper) {
              const isCurrentlyCollapsed = contentWrapper.classList.contains('sidebar-section-collapsed');
              
              if (shouldBeCollapsed && !isCurrentlyCollapsed) {
                contentWrapper.classList.add('sidebar-section-collapsed');
                if (chevron) chevron.textContent = '▲';
              } else if (!shouldBeCollapsed && isCurrentlyCollapsed) {
                contentWrapper.classList.remove('sidebar-section-collapsed');
                if (chevron) chevron.textContent = '▼';
              }
            }
          }
        });
      }

      return true;
    } catch (err) {
      console.error('[SidebarPersistenceService] Error restoring state:', err);
      return false;
    }
  }

  /**
   * Save current sidebar state to localStorage (debounced)
   * @param {Object} state - State service instance
   * @param {Object} viewService - ViewService instance
   * @param {HTMLElement} sidebarElement - Sidebar DOM element
   */
  saveSidebarState(state, viewService, sidebarElement) {
    // Clear existing timeout
    if (this._saveDebounceTimeout) {
      clearTimeout(this._saveDebounceTimeout);
    }

    // Debounce saves to avoid excessive writes
    this._saveDebounceTimeout = setTimeout(() => {
      this._saveImmediately(state, viewService, sidebarElement);
    }, this._saveDebounceMs);
  }

  /**
   * Save sidebar state immediately without debouncing
   * @param {Object} state - State service instance
   * @param {Object} viewService - ViewService instance
   * @param {HTMLElement} sidebarElement - Sidebar DOM element
   * @private
   */
  async _saveImmediately(state, viewService, sidebarElement) {
    try {
      const sidebarState = this.captureSidebarState(state, viewService, sidebarElement);
      await this._dataService.setLocalPref(this._storageKey, sidebarState);
      console.debug('[SidebarPersistenceService] Saved sidebar state:', sidebarState);
    } catch (err) {
      console.error('[SidebarPersistenceService] Error saving state:', err);
    }
  }

  /**
   * Clear saved sidebar state
   */
  async clearSavedState() {
    try {
      await this._dataService.setLocalPref(this._storageKey, null);
      console.debug('[SidebarPersistenceService] Cleared saved state');
    } catch (err) {
      console.error('[SidebarPersistenceService] Error clearing state:', err);
    }
  }
}
