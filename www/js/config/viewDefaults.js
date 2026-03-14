/**
 * Default View Configuration
 * 
 * This file contains the default settings for all view options.
 * These defaults are used when:
 * - Activating the Default View
 * - Initializing the application for the first time
 * - Resetting view settings
 * 
 * To change the defaults, simply modify the values below.
 */

export const DEFAULT_VIEW_OPTIONS = {
  // Timeline scale: 'weeks' | 'months' | 'quarters' | 'years' | 'threeMonths'
  timelineScale: 'months',
  
  // Visibility toggles
  showEpics: true,
  showFeatures: true,
  showDependencies: false,
  showUnassignedCards: true,  // Show features without capacity
  showUnplannedWork: true,     // Show features without dates
  showOnlyProjectHierarchy: false,  // Show only features hierarchically linked to selected projects
  
  // Display modes
  condensedCards: false,
  capacityViewMode: 'team',  // 'team' | 'project'
  featureSortMode: 'rank',   // 'rank' | 'date'
  
  // Task filters (schedule and assignment)
  taskFilters: {
    schedule: ['planned', 'unplanned'],  // All schedule options enabled
    assignment: ['assigned', 'unassigned']  // All assignment options enabled
  },
  
  // State filters - default is empty, will be populated with all available states on init
  selectedFeatureStates: [],
  
  // Task types - default is empty, will be populated with all available types on init
  selectedTaskTypes: [],
  
  // Expansion options
  expandParentChild: false,
  expandRelations: false,
  expandTeamAllocated: false
};

/**
 * Get a fresh copy of default view options
 * @returns {Object} Default view options
 */
export function getDefaultViewOptions() {
  return JSON.parse(JSON.stringify(DEFAULT_VIEW_OPTIONS));
}
