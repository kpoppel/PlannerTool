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

    // Lowercased state name → category string for case-insensitive lookups.
    this._categoriesLower = new Map();

    // Configured global sequence from global_settings (if present).
    this._configuredSequence = [];

    // Lowercased state name → 0-based rank in _states for fast comparisons.
    this._stateRank = new Map();
  }

  // ========== Loading ==========

  _normalizeSequence(rawSequence) {
    if (!Array.isArray(rawSequence)) return [];

    // Required admin format: [{ types: ['New', 'Defined'] }, { types: ['Active'] }]
    const flattened = [];

    for (const item of rawSequence) {
      const levelTypes = Array.isArray(item?.types) ? item.types : [];
      for (const s of levelTypes) {
        const trimmed = String(s || '').trim();
        if (trimmed) flattened.push(trimmed);
      }
    }

    return flattened;
  }

  /**
   * Load state metadata from an array of projects.
   *
   * Ordering rules:
   * 1) If global state_display_sequence is configured, use that order first.
   * 2) Append remaining known states after the configured sequence.
   * 3) If no global sequence is configured, sort by category precedence then name.
   *
   * @param {Array<{display_states?: string[], state_categories?: Object, state_display_sequence?: any[]}>} projects
   */
  loadFromProjects(projects) {
    const seen = new Set();
    const states = [];
    const categories = new Map();
    const categoriesLower = new Map();
    let configuredSequence = [];
    let hasConfiguredSequence = false;

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
            categoriesLower.set(String(state).toLowerCase(), category);
          }
        }
      }

      // Global sequence is copied onto every project payload; use the first non-empty one.
      if (!hasConfiguredSequence && Array.isArray(project.state_display_sequence)) {
        const seq = this._normalizeSequence(project.state_display_sequence);
        if (seq.length > 0) {
          configuredSequence = seq;
          hasConfiguredSequence = true;
        }
      }
    }

    const orderedStates = hasConfiguredSequence
      ? this._applyConfiguredSequence(states, configuredSequence)
      : this._sortByCategoryThenName(states, categoriesLower);

    this._states = orderedStates;
    this._categories = categories;
    this._categoriesLower = categoriesLower;
    this._configuredSequence = configuredSequence;
    this._stateRank = new Map(
      orderedStates.map((stateName, index) => [String(stateName).toLowerCase(), index])
    );
  }

  _applyConfiguredSequence(states, configuredSequence) {
    const byLower = new Map(states.map((s) => [String(s).toLowerCase(), s]));
    const used = new Set();
    const ordered = [];

    for (const seqState of configuredSequence) {
      const key = String(seqState).toLowerCase();
      if (used.has(key)) continue;
      const canonical = byLower.get(key);
      if (!canonical) continue;
      ordered.push(canonical);
      used.add(key);
    }

    for (const stateName of states) {
      const key = String(stateName).toLowerCase();
      if (used.has(key)) continue;
      ordered.push(stateName);
      used.add(key);
    }

    return ordered;
  }

  _sortByCategoryThenName(states, categoriesLower) {
    const CATEGORY_ORDER = {
      proposed: 0,
      inprogress: 1,
      resolved: 2,
      completed: 3,
      removed: 4,
    };

    return [...states].sort((a, b) => {
      const aCat = String(categoriesLower.get(String(a).toLowerCase()) || '').toLowerCase();
      const bCat = String(categoriesLower.get(String(b).toLowerCase()) || '').toLowerCase();
      const aRank = CATEGORY_ORDER[aCat] ?? 99;
      const bRank = CATEGORY_ORDER[bCat] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      return String(a).localeCompare(String(b));
    });
  }

  // ========== State List ==========

  /**
   * Get the ordered list of available feature states (cloned to prevent mutation).
   * @returns {string[]}
   */
  getAvailableStates() {
    return [...this._states];
  }

  /**
   * Returns the configured global state sequence (if any).
   * @returns {string[]}
   */
  getConfiguredSequence() {
    return [...this._configuredSequence];
  }

  /**
   * Compare two state names using the current display ordering.
   * Unknown states sort after known states. "Unassigned" always sorts last.
   *
   * This name matches the PlannerApi/runtime contract used by plugins.
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  compareFeatureStates(a, b) {
    const aText = String(a || '');
    const bText = String(b || '');
    const aLower = aText.toLowerCase();
    const bLower = bText.toLowerCase();

    if (aLower === 'unassigned' && bLower !== 'unassigned') return 1;
    if (bLower === 'unassigned' && aLower !== 'unassigned') return -1;

    const aRank = this._stateRank.get(aLower);
    const bRank = this._stateRank.get(bLower);
    const aKnown = Number.isInteger(aRank);
    const bKnown = Number.isInteger(bRank);

    if (aKnown && bKnown && aRank !== bRank) return aRank - bRank;
    if (aKnown && !bKnown) return -1;
    if (!aKnown && bKnown) return 1;

    return aText.localeCompare(bText);
  }

  // ========== Category Look-up ==========

  /**
   * Get the category for a given state name.
   * @param {string} stateName
   * @returns {string|null} Category string (e.g. "Proposed", "InProgress", "Completed",
   *   "Resolved") or null when no mapping is available.
   */
  getCategoryForState(stateName) {
    const exact = this._categories.get(stateName);
    if (exact != null) return exact;
    return this._categoriesLower.get(String(stateName || '').toLowerCase()) ?? null;
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
