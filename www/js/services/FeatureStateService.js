/**
 * Module: FeatureStateService
 * Intent: Single source of truth for feature state metadata in the frontend
 * Purpose: Hold available states and their category mappings as loaded from
 *          project configuration.  Consumers (StateFilterService, UI components)
 *          ask this service for state lists and category look-ups rather than
 *          inspecting raw project objects themselves.
 *
 * Responsibilities:
 * - Collect and deduplicate display_states across all projects
 * - Store and expose state→category mappings (e.g. "Active" → "InProgress")
 * - Provide ordered list of available states for filtering UI
 * - Provide per-state category look-up for downstream logic
 *
 * The state_categories field on each project is populated server-side from
 * the AzureProjectMetadataService cache and is delivered via /api/projects.
 */

export class FeatureStateService {
  constructor() {
    // Ordered, deduplicated list of state names across all projects
    this._states = [];

    // state name → category string (e.g. "Proposed", "InProgress", "Completed", "Resolved")
    this._categories = new Map();
  }

  // ========== Loading ==========

  /**
   * Load state metadata from an array of projects.
   * Collects display_states in encounter order (first project wins for ordering)
   * and merges state_categories (first definition wins for a given state name).
   *
   * @param {Array<{display_states?: string[], state_categories?: Object}>} projects
   */
  loadFromProjects(projects) {
    const seen = new Set();
    const states = [];
    const categories = new Map();

    for (const project of projects) {
      if (Array.isArray(project.display_states)) {
        for (const state of project.display_states) {
          if (!seen.has(state)) {
            seen.add(state);
            states.push(state);
          }
        }
      }

      if (project.state_categories && typeof project.state_categories === 'object') {
        for (const [state, category] of Object.entries(project.state_categories)) {
          // First project to define a category for a state wins
          if (!categories.has(state)) {
            categories.set(state, category);
          }
        }
      }
    }

    this._states = states;
    this._categories = categories;
  }

  // ========== State List ==========

  /**
   * Get the ordered list of available feature states (cloned to prevent mutation).
   * @returns {string[]}
   */
  getAvailableStates() {
    return [...this._states];
  }

  // ========== Category Look-up ==========

  /**
   * Get the category for a given state name.
   * @param {string} stateName
   * @returns {string|null} Category string (e.g. "Proposed", "InProgress", "Completed",
   *   "Resolved") or null when no mapping is available.
   */
  getCategoryForState(stateName) {
    return this._categories.get(stateName) ?? null;
  }

  /**
   * Get all state→category mappings as a plain object snapshot.
   * @returns {Object<string, string>}
   */
  getStateCategories() {
    return Object.fromEntries(this._categories);
  }

  /**
   * Check whether a state belongs to the given category.
   * @param {string} stateName
   * @param {string} category
   * @returns {boolean}
   */
  isStateInCategory(stateName, category) {
    return this._categories.get(stateName) === category;
  }
}
