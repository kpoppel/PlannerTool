// @ts-nocheck
/**
 * Feature Flags Configuration
 * Controls which new features are enabled
 * Set flags to true to enable new implementations
 */

export const featureFlags = {
  // Enhanced EventBus loggers
  LOG_EVENT_HISTORY: true,

  // Epic capacity handling/cost calculation modes:
  // false: 'ignoreIfHasChildren' - Ignore parent capacity entirely if it has any children
  // true: 'teamAwareChildPrecedence' - Children take full precedence for their team only.
  //   If Team A has children, Team A parent capacity is suppressed for the entire parent date range.
  //   If Team B has no children, Team B parent capacity is used normally.
  //   This correctly handles asynchronous breakdown: teams that haven't defined children yet
  //   continue to show their parent-level estimates, while teams that have broken down their
  //   work show only their more accurate child-level estimates.
  USE_PARENT_CAPACITY_GAP_FILLS: true,

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
