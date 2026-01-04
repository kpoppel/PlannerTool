/**
 * Module: StateFilterService
 * Intent: Manage feature state filtering (status/state selection and visibility)
 * Purpose: Extract state filtering logic from State.js for better separation of concerns
 * 
 * Responsibilities:
 * - Maintain available feature states (extracted from features)
 * - Track selected/filtered states (Set-based for efficient lookup)
 * - Provide state filter operations (toggle, set, select all/none)
 * - Emit filter change events
 * 
 * Events emitted:
 * - FilterEvents.CHANGED: When state filter selection changes
 * - FeatureEvents.UPDATED: Trigger feature re-render after filter change
 * - CapacityEvents.UPDATED: Trigger capacity recalculation after filter change
 */

import { FilterEvents, FeatureEvents, StateFilterEvents } from '../core/EventRegistry.js';

export class StateFilterService {
  /**
   * Create a new StateFilterService
   * @param {EventBus} bus - Event bus for emitting filter changes
   */
  constructor(bus) {
    this.bus = bus;
    
    // Available states discovered from features
    this._availableFeatureStates = [];
    
    // Selected states (Set for efficient lookup)
    this._selectedFeatureStateFilter = new Set();
  }
  
  // ========== Available States Management ==========
  
  /**
   * Get list of available feature states
   * @returns {Array<string>}
   */
  get availableFeatureStates() {
    return this._availableFeatureStates;
  }
  
  /**
   * Set available feature states (typically extracted from baseline features)
   * Automatically selects all states if no explicit selection exists
   * @param {Array<string>} states - Array of state names
   */
  setAvailableStates(states) {
    this._availableFeatureStates = [...states]; // Clone array
    
    // Auto-select all states if no explicit selection exists
    if (this._selectedFeatureStateFilter.size === 0) {
      this._selectedFeatureStateFilter = new Set(this._availableFeatureStates);
    }
    
    // Emit state list changed event
    this.bus.emit(StateFilterEvents.CHANGED, this._availableFeatureStates);
  }
  
  // ========== Selected States Management ==========
  
  /**
   * Get selected state filter as Set
   * @returns {Set<string>}
   */
  get selectedFeatureStateFilter() {
    return this._selectedFeatureStateFilter;
  }
  
  /**
   * Get selected states as Array
   * @returns {Array<string>}
   */
  getSelectedStates() {
    return Array.from(this._selectedFeatureStateFilter);
  }
  
  /**
   * Check if a state is currently selected
   * @param {string} stateName - State name to check
   * @returns {boolean}
   */
  isStateSelected(stateName) {
    return this._selectedFeatureStateFilter.has(stateName);
  }
  
  /**
   * Get count of selected states
   * @returns {number}
   */
  getSelectedCount() {
    return this._selectedFeatureStateFilter.size;
  }
  
  // ========== State Filter Operations ==========
  
  /**
   * Set state filter (legacy single-state or select-all behavior)
   * @param {string|null} stateName - State name to select (null = select all)
   */
  setStateFilter(stateName) {
    if (stateName === null) {
      // Select all states
      this._selectedFeatureStateFilter = new Set(this._availableFeatureStates || []);
    } else {
      // Select single state (legacy behavior)
      this._selectedFeatureStateFilter = new Set(stateName ? [stateName] : []);
    }
    
    this._emitFilterChanged();
  }
  
  /**
   * Toggle a single state's selection on/off
   * @param {string} stateName - State name to toggle
   */
  toggleStateSelected(stateName) {
    if (!stateName) return;
    
    if (this._selectedFeatureStateFilter.has(stateName)) {
      this._selectedFeatureStateFilter.delete(stateName);
    } else {
      this._selectedFeatureStateFilter.add(stateName);
    }
    
    console.debug('[StateFilterService] toggleStateSelected ->', 
      Array.from(this._selectedFeatureStateFilter));
    
    this._emitFilterChanged();
  }
  
  /**
   * Select or clear all states
   * @param {boolean} selectAll - True to select all, false to clear all
   */
  setAllStatesSelected(selectAll) {
    if (selectAll) {
      this._selectedFeatureStateFilter = new Set(this._availableFeatureStates || []);
    } else {
      this._selectedFeatureStateFilter = new Set();
    }
    
    this._emitFilterChanged();
  }
  
  /**
   * Set selected states from array
   * @param {Array<string>} states - Array of state names to select
   */
  setSelectedStates(states) {
    this._selectedFeatureStateFilter = new Set(states || []);
    this._emitFilterChanged();
  }
  
  // ========== Helper Methods ==========
  
  /**
   * Emit filter change events
   * @private
   */
  _emitFilterChanged() {
    this.bus.emit(FilterEvents.CHANGED, { 
      selectedFeatureStateFilter: Array.from(this._selectedFeatureStateFilter) 
    });
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  /**
   * Restore filter state from snapshot (e.g., when activating a scenario)
   * Note: This does NOT emit events (caller should emit after full state restore)
   * @param {Object} filterState - Filter state snapshot
   */
  restoreFilterState(filterState) {
    if (!filterState) return;
    
    if (filterState.selectedStates) {
      this._selectedFeatureStateFilter = new Set(filterState.selectedStates);
    }
  }
  
  /**
   * Capture current filter state for scenario persistence
   * @returns {Object} Filter state snapshot
   */
  captureFilterState() {
    return {
      selectedStates: Array.from(this._selectedFeatureStateFilter)
    };
  }
}
