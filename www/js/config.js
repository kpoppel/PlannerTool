/**
 * Feature Flags Configuration
 * Controls which new features are enabled
 * Set flags to true to enable new implementations
 */

export const featureFlags = {
  // Enhanced EventBus loggers
  WARN_ON_STRING_EVENTS: true,
  LOG_EVENT_HISTORY: true,
  
  // Plugin System
  USE_PLUGIN_SYSTEM: true,
  
  // Phase 8-9: Lit Components
  USE_LIT_COMPONENTS: true,
//  USE_LIT_COMPONENTS: false,
  
  // Phase 10: Command Pattern (Undo/Redo)
  USE_COMMAND_PATTERN: false,
  serviceInstrumentation: false,
  
  // Enable the experimental queued/idle processing FeatureService
  USE_QUEUED_FEATURE_SERVICE: false,
  
  // Epic capacity handling/cost calculation modes:
  // false: 'ignoreIfHasChildren' - Ignore epic capacity entirely if the epic has any children
  // true: 'fillGapsIfNoChildCoversDate' - Use epic capacity only on days where no child feature covers the date
  USE_EPIC_CAPACITY_GAP_FILLS: false,

  // Unplanned work visualization:
  // false: Add default dates (today-120 to today-90) to features with no dates
  // true: Show unplanned features as ghosted cards at today's date, user can drag to set dates
  SHOW_UNPLANNED_WORK: true,

  // Runtime override support (for testing)
  // Usage: window.__featureFlags = { FEATURE_FLAG_NAME: true };
  ...(typeof window !== 'undefined' && window.__featureFlags ? window.__featureFlags : {})
};

// Visible features for components
// Enable cost teams tab in UI
export const UIFeatureFlags = {
  SHOW_COST_TEAMS_TAB: true,
  MUTE_ZERO_CELLS: true
};

/**
 * Check if a feature is enabled
 * @param {string} flagName - Name of the feature flag
 * @returns {boolean}
 */
export function isEnabled(flagName) {
  return featureFlags[flagName] === true;
}

/**
 * Enable a feature at runtime (for testing)
 * @param {string} flagName - Name of the feature flag
 */
export function enable(flagName) {
  featureFlags[flagName] = true;
  console.log(`[FeatureFlags] Enabled: ${flagName}`);
}

/**
 * Disable a feature at runtime (for testing)
 * @param {string} flagName - Name of the feature flag
 */
export function disable(flagName) {
  featureFlags[flagName] = false;
  console.log(`[FeatureFlags] Disabled: ${flagName}`);
}
