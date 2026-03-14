/**
 * SidebarPersistenceService
 * Utility service for capturing current sidebar state (projects, teams, view options).
 * Used by ViewManagementService when saving views.
 * 
 * Note: This service no longer manages localStorage directly.
 * All persistence is now handled through the View feature via ViewManagementService.
 */

export class SidebarPersistenceService {
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

    // Capture selected task types (from sidebar element) if present
    if (sidebarElement && sidebarElement.selectedTaskTypes) {
      try {
        sidebarState.viewOptions.selectedTaskTypes = Array.from(sidebarElement.selectedTaskTypes || []);
      } catch (e) { /* ignore */ }
    }

    // Capture task filters (formerly view filters). Overwrite legacy state — save only new key.
    if (state.taskFilterService) {
      sidebarState.viewOptions.taskFilters = state.taskFilterService.getFilters();
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
}
