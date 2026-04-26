/**
 * Module: ViewService
 * Intent: Manage all view-related state (timeline scale, visibility toggles, view modes, sort modes)
 * Purpose: Extract view state management from State.js to reduce coupling and improve testability
 *
 * Responsibilities:
 * - Maintain view state properties (timelineScale, showEpics, showFeatures, condensedCards, etc.)
 * - Emit appropriate events when view state changes
 * - Provide getters/setters for view properties
 * - Capture current view state for scenario persistence
 *
 * Events emitted:
 * - TimelineEvents.SCALE_CHANGED: when timeline scale changes
 * - FilterEvents.CHANGED: when type visibility (hiddenTypes) changes
 * - ViewEvents.CONDENSED: when condensed card mode changes
 * - ViewEvents.DEPENDENCIES: when dependency visibility changes
 * - ViewEvents.CAPACITY_MODE: when capacity view mode changes
 * - ViewEvents.SORT_MODE: when feature sort mode changes
 * - FeatureEvents.UPDATED: trigger feature re-render when view affects display
 */

import {
  TimelineEvents,
  FilterEvents,
  ViewEvents,
  FeatureEvents,
} from '../core/EventRegistry.js';
// Local monthWidth mapping to avoid circular import with Timeline component
function getMonthWidthForScale(scale) {
  const ZOOM_LEVELS = {
    weeks: 240,
    months: 120,
    threeMonths: null,
    quarters: 60,
    years: 30,
  };
  if (scale === 'threeMonths') {
    // Find timelineSection inline to avoid circular dependency with board-utils
    let section = null;
    if (typeof document !== 'undefined') {
      const boardEl = document.querySelector('timeline-board');
      if (boardEl) {
        const root = boardEl.renderRoot || boardEl.shadowRoot || boardEl;
        section = root && root.querySelector ? root.querySelector('#timelineSection') : null;
      }
    }
    if (section && section.clientWidth) {
      return Math.max(30, Math.floor(section.clientWidth / 3));
    }
    return 120;
  }
  return ZOOM_LEVELS[scale] ?? 120;
}

export class ViewService {
  /**
   * Create a new ViewService
   * @param {EventBus} bus - The event bus for emitting view changes
   */
  constructor(bus) {
    this.bus = bus;

    // Timeline properties
    this._timelineScale = 'months';

    // Visibility toggles
    // _hiddenTypes: Set<string> of lower-cased type names that are hidden.
    // Empty set means all types are visible (the default).
    this._hiddenTypes = new Set();
    this._showDependencies = false;
    this._showUnassignedCards = true; // Show features without capacity by default
    this._showUnplannedWork = true; // Show features without dates by default (when feature flag is ON)
    this._showOnlyProjectHierarchy = false; // Show only features hierarchically linked to selected projects

    // Display modes
    // _displayMode: 'normal' | 'compact' | 'packed'
    // 'normal'  – full card info, one lane per feature
    // 'compact' – reduced card height, one lane per feature
    // 'packed'  – compact height + greedy interval packing (multiple features per lane)
    this._displayMode = 'normal';
    this._capacityViewMode = 'team'; // 'team' | 'project'
    this._featureSortMode = 'rank'; // 'rank' | 'date'
    //TODO: Wire this into the sidepanel:
    this._highlightFeatureRelationMode = true; // If true, highlight features when clicked.
  }

  // ========== Timeline Scale ==========

  /**
   * Get current timeline scale
   * @returns {string} 'weeks' | 'months' | 'quarters' | 'years'
   */
  get timelineScale() {
    return this._timelineScale;
  }

  /**
   * Set timeline scale and emit change event
   * @param {string} scale - Timeline scale ('weeks', 'months', 'quarters', 'years')
   */
  setTimelineScale(scale) {
    const validScales = ['weeks', 'months', 'quarters', 'years', 'threeMonths'];
    if (!validScales.includes(scale)) {
      console.warn(`Invalid timeline scale: ${scale}, defaulting to 'months'`);
      scale = 'months';
    }
    if (this._timelineScale === scale) return;
    const oldScale = this._timelineScale;
    this._timelineScale = scale;
    const monthWidth = getMonthWidthForScale(scale);
    // emit unless suppressed
    if (!arguments[1]) {
      this.bus.emit(TimelineEvents.SCALE_CHANGED, {
        scale,
        monthWidth,
        oldScale,
      });
    }
  }

  // ========== Task Type Visibility ==========

  /**
   * Get the set of currently hidden type names (lower-cased).
   * Empty set = all types visible.
   * @returns {Set<string>}
   */
  get hiddenTypes() {
    return this._hiddenTypes;
  }

  /**
   * Return true if the given task type should be shown.
   * @param {string} type - Task type name (case-insensitive)
   * @returns {boolean}
   */
  isTypeVisible(type) {
    return !this._hiddenTypes.has(String(type || '').toLowerCase());
  }

  /**
   * Show or hide a specific task type and emit filter/feature events.
   * @param {string} type - Task type name (case-insensitive)
   * @param {boolean} visible - true to show, false to hide
   */
  setTypeVisibility(type, visible) {
    const key = String(type || '').toLowerCase();
    if (visible) {
      this._hiddenTypes.delete(key);
    } else {
      this._hiddenTypes.add(key);
    }
    if (!arguments[2]) {
      this.bus.emit(FilterEvents.CHANGED, {
        hiddenTypes: Array.from(this._hiddenTypes),
      });
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }

  // ========== Visibility Toggles ==========

  /**
   * Get whether dependencies are visible
   * @returns {boolean}
   */
  get showDependencies() {
    return this._showDependencies;
  }

  /**
   * Set dependency visibility and emit change events
   * @param {boolean} val - Whether to show dependencies
   */
  setShowDependencies(val) {
    this._showDependencies = !!val;
    console.debug('[ViewService] setShowDependencies ->', this._showDependencies);
    if (!arguments[1]) {
      this.bus.emit(ViewEvents.DEPENDENCIES, this._showDependencies);
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }

  /**
   * Get whether unassigned cards (features without capacity) are visible
   * @returns {boolean}
   */
  get showUnassignedCards() {
    return this._showUnassignedCards;
  }

  /**
   * Set unassigned cards visibility and emit change events
   * @param {boolean} val - Whether to show features without capacity
   */
  setShowUnallocatedCards(val) {
    this._showUnassignedCards = !!val;
    console.debug('[ViewService] setShowUnallocatedCards ->', this._showUnassignedCards);
    if (!arguments[1]) {
      this.bus.emit(FilterEvents.CHANGED, {
        showUnassignedCards: this._showUnassignedCards,
      });
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }

  /**
   * Get whether unplanned work (features without dates) is visible
   * @returns {boolean}
   */
  get showUnplannedWork() {
    return this._showUnplannedWork;
  }

  /**
   * Set unplanned work visibility and emit change events
   * @param {boolean} val - Whether to show features without dates
   */
  setShowUnplannedWork(val) {
    this._showUnplannedWork = !!val;
    console.debug('[ViewService] setShowUnplannedWork ->', this._showUnplannedWork);
    if (!arguments[1]) {
      this.bus.emit(FilterEvents.CHANGED, {
        showUnplannedWork: this._showUnplannedWork,
      });
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }

  /**
   * Get whether to show only features hierarchically linked to selected projects
   * @returns {boolean}
   */
  get showOnlyProjectHierarchy() {
    return this._showOnlyProjectHierarchy;
  }

  /**
   * Set whether to show only features hierarchically linked to selected projects
   * @param {boolean} val - Whether to filter by project hierarchy
   */
  setShowOnlyProjectHierarchy(val) {
    this._showOnlyProjectHierarchy = !!val;
    if (!arguments[1]) {
      this.bus.emit(FilterEvents.CHANGED, {
        showOnlyProjectHierarchy: this._showOnlyProjectHierarchy,
      });
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }

  // ========== Display Modes ==========

  /**
   * Get current display mode.
   * @returns {'normal'|'compact'|'packed'}
   */
  get displayMode() {
    return this._displayMode;
  }

  /**
   * Set display mode and emit change events.
   * @param {'normal'|'compact'|'packed'} mode
   */
  setDisplayMode(mode) {
    if (mode !== 'normal' && mode !== 'compact' && mode !== 'packed') {
      console.warn(`Invalid display mode: ${mode}, defaulting to 'normal'`);
      mode = 'normal';
    }
    if (this._displayMode === mode) return;
    this._displayMode = mode;
    if (!arguments[1]) {
      // Emit CONDENSED for backward compatibility (listeners re-render on display change)
      this.bus.emit(ViewEvents.CONDENSED, this.condensedCards);
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }

  /**
   * Get whether condensed card mode is enabled (true for 'compact' and 'packed').
   * Retained for backward compatibility.
   * @returns {boolean}
   */
  get condensedCards() {
    return this._displayMode !== 'normal';
  }

  /**
   * Set condensed card mode (backward-compat shim).
   * Maps to displayMode 'compact' (true) or 'normal' (false).
   * Does NOT enter 'packed' mode — use setDisplayMode('packed') for that.
   * @param {boolean} val
   */
  setCondensedCards(val) {
    this.setDisplayMode(val ? 'compact' : 'normal', arguments[1]);
  }

  /**
   * Get whether packed mode is active.
   * In packed mode features with non-overlapping dates share a lane.
   * @returns {boolean}
   */
  get packedMode() {
    return this._displayMode === 'packed';
  }

  /**
   * Get capacity view mode
   * @returns {string} 'team' | 'project'
   */
  get capacityViewMode() {
    return this._capacityViewMode;
  }

  /**
   * Set capacity view mode and emit change events
   * @param {string} mode - View mode ('team' | 'project')
   */
  setCapacityViewMode(mode) {
    if (mode !== 'team' && mode !== 'project') return;
    if (this._capacityViewMode === mode) return;
    this._capacityViewMode = mode;
    if (!arguments[1]) {
      this.bus.emit(ViewEvents.CAPACITY_MODE, this._capacityViewMode);
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }

  /**
   * Get feature sort mode
   * @returns {string} 'rank' | 'date'
   */
  get featureSortMode() {
    return this._featureSortMode;
  }

  /**
   * Set feature sort mode and emit change events
   * @param {string} mode - Sort mode ('rank' | 'date')
   */
  setFeatureSortMode(mode) {
    if (mode !== 'date' && mode !== 'rank') return;
    if (this._featureSortMode === mode) return;
    this._featureSortMode = mode;
    if (!arguments[1]) {
      this.bus.emit(ViewEvents.SORT_MODE, this._featureSortMode);
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }

  get highlightFeatureRelationMode() {
    return this._highlightFeatureRelationMode;
  }

  setHighlightFeatureRelationMode(val) {
    this._highlightFeatureRelationMode = !!val;
    if (!arguments[1]) {
      this.bus.emit(ViewEvents.HIGHLIGHT_RELATIONS, this._highlightFeatureRelationMode);
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }
  // ========== State Capture ==========

  /**
   * Capture current view state for scenario persistence
   * @returns {Object} View state snapshot
   */
  captureCurrentView() {
    return {
      capacityViewMode: this._capacityViewMode,
      displayMode: this._displayMode,
      // condensedCards retained for backward compatibility
      condensedCards: this.condensedCards,
      featureSortMode: this._featureSortMode,
      highlightFeatureRelationMode: this._highlightFeatureRelationMode,
      showUnassignedCards: this._showUnassignedCards,
      showDependencies: this._showDependencies,
      showUnplannedWork: this._showUnplannedWork,
      timelineScale: this._timelineScale,
      hiddenTypes: Array.from(this._hiddenTypes),
      showOnlyProjectHierarchy: this._showOnlyProjectHierarchy,
    };
  }

  /**
   * Restore view state from snapshot (e.g., when activating a scenario)
   * @param {Object} viewState - View state snapshot
   */
  /**
   * Apply a view state to internal properties without emitting any events.
   * Useful for silent restore during initial load.
   * @param {Object} viewState
   */
  applyViewStateSilently(viewState) {
    if (!viewState) return;
    if (viewState.capacityViewMode) this._capacityViewMode = viewState.capacityViewMode;
    // Restore displayMode; fall back to condensedCards boolean for older saved views
    if (viewState.displayMode) {
      this._displayMode = viewState.displayMode;
    } else if (typeof viewState.condensedCards !== 'undefined') {
      this._displayMode = viewState.condensedCards ? 'compact' : 'normal';
    }
    if (viewState.featureSortMode) this._featureSortMode = viewState.featureSortMode;
    if (typeof viewState.highlightFeatureRelationMode !== 'undefined')
      this._highlightFeatureRelationMode = !!viewState.highlightFeatureRelationMode;
    if (typeof viewState.showUnassignedCards !== 'undefined')
      this._showUnassignedCards = !!viewState.showUnassignedCards;
    if (typeof viewState.showDependencies !== 'undefined')
      this._showDependencies = !!viewState.showDependencies;
    if (typeof viewState.showUnplannedWork !== 'undefined')
      this._showUnplannedWork = !!viewState.showUnplannedWork;
    if (viewState.timelineScale) this._timelineScale = viewState.timelineScale;
    // New format: hiddenTypes is an array of lower-cased type names.
    if (Array.isArray(viewState.hiddenTypes)) {
      this._hiddenTypes = new Set(viewState.hiddenTypes);
    } else {
      // Backward-compat: translate legacy showEpics/showFeatures booleans
      if (viewState.showEpics === false) this._hiddenTypes.add('epic');
      if (viewState.showFeatures === false) this._hiddenTypes.add('feature');
    }
    if (typeof viewState.showOnlyProjectHierarchy !== 'undefined')
      this._showOnlyProjectHierarchy = !!viewState.showOnlyProjectHierarchy;
  }

  /**
   * Restore view state from snapshot (e.g., when activating a scenario)
   * @param {Object} viewState - View state snapshot
   * @param {boolean} emitAggregated - When true, emit aggregated events after applying
   */
  restoreView(viewState, emitAggregated = true) {
    if (!viewState) return;
    // Apply silently to avoid per-setter emits
    this.applyViewStateSilently(viewState);

    if (emitAggregated) {
      this.bus.emit(FilterEvents.CHANGED, {
        hiddenTypes: Array.from(this._hiddenTypes),
        showUnassignedCards: this._showUnassignedCards,
        showUnplannedWork: this._showUnplannedWork,
        showOnlyProjectHierarchy: this._showOnlyProjectHierarchy,
      });
      this.bus.emit(ViewEvents.DEPENDENCIES, this._showDependencies);
      this.bus.emit(ViewEvents.CONDENSED, this.condensedCards);
      this.bus.emit(ViewEvents.CAPACITY_MODE, this._capacityViewMode);
      this.bus.emit(ViewEvents.SORT_MODE, this._featureSortMode);
      this.bus.emit(ViewEvents.HIGHLIGHT_RELATIONS, this._highlightFeatureRelationMode);
      this.bus.emit(FeatureEvents.UPDATED);
    }
  }
}
