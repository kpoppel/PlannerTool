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
 * - FilterEvents.CHANGED: when showEpics/showFeatures changes
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
  FeatureEvents 
} from '../core/EventRegistry.js';
// Local monthWidth mapping to avoid circular import with Timeline component
function getMonthWidthForScale(scale) {
  const ZOOM_LEVELS = {
    weeks: 240,
    months: 120,
    quarters: 60,
    years: 30
  };
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
    this._showEpics = true;
    this._showFeatures = true;
    this._showDependencies = false;
    this._showUnassignedCards = true; // Show features without capacity by default
    this._showUnplannedWork = true; // Show features without dates by default (when feature flag is ON)
    
    // Display modes
    this._condensedCards = false;
    this._capacityViewMode = 'team'; // 'team' | 'project'
    this._featureSortMode = 'rank'; // 'rank' | 'date'
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
    const validScales = ['weeks', 'months', 'quarters', 'years'];
    if (!validScales.includes(scale)) {
      console.warn(`Invalid timeline scale: ${scale}, defaulting to 'months'`);
      scale = 'months';
    }
    if (this._timelineScale === scale) return;
    
    const oldScale = this._timelineScale;
    this._timelineScale = scale;
    const monthWidth = getMonthWidthForScale(scale);

    this.bus.emit(TimelineEvents.SCALE_CHANGED, { scale, monthWidth, oldScale });
  }
  
  // ========== Visibility Toggles ==========
  
  /**
   * Get whether epics are visible
   * @returns {boolean}
   */
  get showEpics() {
    return this._showEpics;
  }
  
  /**
   * Set epic visibility and emit change events
   * @param {boolean} val - Whether to show epics
   */
  setShowEpics(val) {
    this._showEpics = !!val;
    this.bus.emit(FilterEvents.CHANGED, { 
      showEpics: this._showEpics, 
      showFeatures: this._showFeatures 
    });
    // Notify that features changed so dependent renderers (like dependency lines) refresh
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  /**
   * Get whether features are visible
   * @returns {boolean}
   */
  get showFeatures() {
    return this._showFeatures;
  }
  
  /**
   * Set feature visibility and emit change events
   * @param {boolean} val - Whether to show features
   */
  setShowFeatures(val) {
    this._showFeatures = !!val;
    this.bus.emit(FilterEvents.CHANGED, { 
      showEpics: this._showEpics, 
      showFeatures: this._showFeatures 
    });
    // Notify that features changed so dependent renderers (like dependency lines) refresh
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
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
    this.bus.emit(ViewEvents.DEPENDENCIES, this._showDependencies);
    this.bus.emit(FeatureEvents.UPDATED);
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
  setShowUnassignedCards(val) {
    this._showUnassignedCards = !!val;
    console.debug('[ViewService] setShowUnassignedCards ->', this._showUnassignedCards);
    this.bus.emit(FilterEvents.CHANGED, { 
      showUnassignedCards: this._showUnassignedCards 
    });
    this.bus.emit(FeatureEvents.UPDATED);
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
    this.bus.emit(FilterEvents.CHANGED, { 
      showUnplannedWork: this._showUnplannedWork 
    });
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  // ========== Display Modes ==========
  
  /**
   * Get whether condensed card mode is enabled
   * @returns {boolean}
   */
  get condensedCards() {
    return this._condensedCards;
  }
  
  /**
   * Set condensed card mode and emit change events
   * @param {boolean} val - Whether to use condensed cards
   */
  setCondensedCards(val) {
    this._condensedCards = !!val;
    this.bus.emit(ViewEvents.CONDENSED, this._condensedCards);
    this.bus.emit(FeatureEvents.UPDATED);
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
    this.bus.emit(ViewEvents.CAPACITY_MODE, this._capacityViewMode);
    this.bus.emit(FeatureEvents.UPDATED);
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
    this.bus.emit(ViewEvents.SORT_MODE, this._featureSortMode);
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  // ========== State Capture ==========
  
  /**
   * Capture current view state for scenario persistence
   * @returns {Object} View state snapshot
   */
  captureCurrentView() {
    return {
      capacityViewMode: this._capacityViewMode,
      condensedCards: this._condensedCards,
      featureSortMode: this._featureSortMode,
      showUnassignedCards: this._showUnassignedCards,
      showUnplannedWork: this._showUnplannedWork,
      timelineScale: this._timelineScale
    };
  }
  
  /**
   * Restore view state from snapshot (e.g., when activating a scenario)
   * @param {Object} viewState - View state snapshot
   */
  restoreView(viewState) {
    if (!viewState) return;
    
    if (viewState.capacityViewMode) {
      this.setCapacityViewMode(viewState.capacityViewMode);
    }
    if (typeof viewState.condensedCards !== 'undefined') {
      this.setCondensedCards(viewState.condensedCards);
    }
    if (viewState.featureSortMode) {
      this.setFeatureSortMode(viewState.featureSortMode);
    }
    if (typeof viewState.showUnassignedCards !== 'undefined') {
      this.setShowUnassignedCards(viewState.showUnassignedCards);
    }
    if (typeof viewState.showUnplannedWork !== 'undefined') {
      this.setShowUnplannedWork(viewState.showUnplannedWork);
    }
    if (viewState.timelineScale) {
      this.setTimelineScale(viewState.timelineScale);
    }
  }
}
