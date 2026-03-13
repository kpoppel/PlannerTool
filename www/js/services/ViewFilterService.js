/**
 * ViewFilterService
 * Manages dimensional view filters (schedule, allocation, hierarchy, relations)
 * Each dimension has two options that can be independently toggled
 */

import { FilterEvents, FeatureEvents } from '../core/EventRegistry.js';

export class ViewFilterService {
  constructor(bus) {
    this.bus = bus;
    
    // Each dimension has two checkboxes that can be independently toggled
    // Default: all checked (show everything)
    this._filters = {
      schedule: {
        planned: true,    // Has start and end dates
        unplanned: true   // Missing dates
      },
      allocation: {
        allocated: true,    // Has team capacity allocations
        unallocated: true   // No capacity allocations
      },
      hierarchy: {
        hasParent: true,  // Has a parent epic
        noParent: true    // No parent (orphan or top-level epic)
      },
      relations: {
        hasLinks: true,   // Has dependency links (predecessor/successor/related)
        noLinks: true     // No dependency links
      }
    };
  }
  
  /**
   * Get current filter state
   */
  getFilters() {
    return JSON.parse(JSON.stringify(this._filters)); // Deep copy
  }
  
  /**
   * Toggle a specific filter option
   * @param {string} dimension - 'schedule', 'allocation', 'hierarchy', 'relations'
   * @param {string} option - The specific option within the dimension
   */
  toggleFilter(dimension, option) {
    if (!this._filters[dimension] || this._filters[dimension][option] === undefined) {
      console.warn(`[ViewFilterService] Invalid filter: ${dimension}.${option}`);
      return;
    }
    
    this._filters[dimension][option] = !this._filters[dimension][option];
    this._emitFilterChanged();
  }
  
  /**
   * Set a specific filter option
   */
  setFilter(dimension, option, value) {
    if (!this._filters[dimension] || this._filters[dimension][option] === undefined) {
      console.warn(`[ViewFilterService] Invalid filter: ${dimension}.${option}`);
      return;
    }
    
    this._filters[dimension][option] = !!value;
    this._emitFilterChanged();
  }
  
  /**
   * Check if a feature passes the view filters
   * @param {Object} feature - Feature to check
   * @returns {boolean}
   */
  featurePassesFilters(feature) {
    // Schedule filter
    const hasSchedule = !!(feature.start && feature.end);
    const scheduleOk = (hasSchedule && this._filters.schedule.planned) || 
                       (!hasSchedule && this._filters.schedule.unplanned);
    if (!scheduleOk) return false;
    
    // Allocation filter
    const hasAllocation = feature.capacity && feature.capacity.length > 0 && 
                          feature.capacity.some(c => c && c.capacity && Number(c.capacity) > 0);
    const allocationOk = (hasAllocation && this._filters.allocation.allocated) || 
                         (!hasAllocation && this._filters.allocation.unallocated);
    if (!allocationOk) return false;
    
    // Hierarchy filter
    const hasParent = !!(feature.parentEpic);
    const hierarchyOk = (hasParent && this._filters.hierarchy.hasParent) || 
                        (!hasParent && this._filters.hierarchy.noParent);
    if (!hierarchyOk) return false;
    
    // Relations filter
    const hasLinks = feature.relations && feature.relations.length > 0;
    const relationsOk = (hasLinks && this._filters.relations.hasLinks) || 
                        (!hasLinks && this._filters.relations.noLinks);
    if (!relationsOk) return false;
    
    return true;
  }
  
  /**
   * Restore filters from saved state
   */
  restoreFilters(savedFilters) {
    if (!savedFilters) return;
    
    // Merge saved filters with defaults
    Object.keys(this._filters).forEach(dimension => {
      if (savedFilters[dimension]) {
        Object.keys(this._filters[dimension]).forEach(option => {
          if (savedFilters[dimension][option] !== undefined) {
            this._filters[dimension][option] = savedFilters[dimension][option];
          }
        });
      }
    });
  }
  
  /**
   * Emit filter change event
   */
  _emitFilterChanged() {
    this.bus.emit(FilterEvents.CHANGED, { viewFilters: this._filters });
    this.bus.emit(FeatureEvents.UPDATED);
  }
  
  /**
   * Reset all filters to default (all checked)
   */
  resetFilters() {
    this._filters = {
      schedule: { planned: true, unplanned: true },
      allocation: { allocated: true, unallocated: true },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true }
    };
    this._emitFilterChanged();
  }
}
