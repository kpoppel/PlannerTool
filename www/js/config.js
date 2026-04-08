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
  // false: 'ignoreIfHasChildren' - Ignore parent capacity entirely if it has any children
  // true: 'teamAwareChildPrecedence' - Children take full precedence for their team only.
  //   If Team A has children, Team A parent capacity is suppressed for the entire parent date range.
  //   If Team B has no children, Team B parent capacity is used normally.
  //   This correctly handles asynchronous breakdown: teams that haven't defined children yet
  //   continue to show their parent-level estimates, while teams that have broken down their
  //   work show only their more accurate child-level estimates.
  USE_PARENT_CAPACITY_GAP_FILLS: true,

  // Unplanned work visualization:
  // false: Add default dates (today-120 to today-90) to features with no dates
  // true: Show unplanned features as ghosted cards at today's date, user can drag to set dates
  SHOW_UNPLANNED_WORK: true,

  // When true: keep unplanned children unplanned when their parent epic is moved.
  // When false: moving/planning an epic may assign default dates to unplanned children (legacy behaviour).
  PRESERVE_UNPLANNED_CHILDREN_ON_PARENT_MOVE: true,

  // Controls which plans contribute to the mainGraph capacity lines.
  // false (default): graph always reflects ALL plans regardless of which project cards are
  //   selected on the board.  The Teams menu continues to control which team lines are visible.
  //   This gives an accurate total-org load picture at all times.
  // true: legacy behaviour — graph only counts capacity from the currently selected plans,
  //   which can hide overallocation caused by unselected plans.
  GRAPH_ONLY_SELECTED_PLANS: false,

  // Runtime override support (for testing)
  // Usage: window.__featureFlags = { FEATURE_FLAG_NAME: true };
  ...(typeof window !== 'undefined' && window.__featureFlags ?
    window.__featureFlags
  : {}),
};

// Visible features for components
// Enable cost teams tab in UI
export const UIFeatureFlags = {
  SHOW_COST_TEAMS_TAB: true,
  MUTE_ZERO_CELLS: true,
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
