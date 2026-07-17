/**
 * TaskFilterService
 * Manages dimensional task filters (schedule, allocation, hierarchy, relations)
 * Each dimension has two options that can be independently toggled
 */

import { FilterEvents, FeatureEvents } from '../core/EventRegistry.js';

const DEFAULT_TASK_FILTER_ENV = {
  events: {
    emitFilterChanged: (bus, payload) => {
      bus?.emit?.(FilterEvents.CHANGED, payload);
    },
    emitFeatureUpdated: (bus, payload) => {
      bus?.emit?.(FeatureEvents.UPDATED, payload);
    },
  },
};

export class TaskFilterService {
  constructor(bus, env = {}) {
    this.bus = bus;
    this._store = env.store || null;
    this._env = {
      events: {
        ...DEFAULT_TASK_FILTER_ENV.events,
        ...(env.events || {}),
      },
    };
  }

  _defaultFilters() {
    return {
      schedule: { planned: true, unplanned: true },
      allocation: { allocated: true, unallocated: true },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true },
    };
  }

  _readFilters() {
    return this._store?.getState?.()?.selection?.taskFilters || this._defaultFilters();
  }

  _writeFilters(nextFilters) {
    if (this._store?.update) {
      this._store.update('selection.taskFilters.command', (draft) => {
        draft.selection.taskFilters = nextFilters;
      });
      return;
    }
    this._fallbackFilters = nextFilters;
  }

  /**
   * Get current filter state
   */
  getFilters() {
    return JSON.parse(JSON.stringify(this._readFilters()));
  }

  /**
   * Toggle a specific filter option
   * @param {string} dimension - 'schedule', 'allocation', 'hierarchy', 'relations'
   * @param {string} option - The specific option within the dimension
   */
  toggleFilter(dimension, option) {
    const filters = this._readFilters();
    if (!filters[dimension] || filters[dimension][option] === undefined) {
      console.warn(`[TaskFilterService] Invalid filter: ${dimension}.${option}`);
      return;
    }

    const nextFilters = JSON.parse(JSON.stringify(filters));
    nextFilters[dimension][option] = !nextFilters[dimension][option];
    this._writeFilters(nextFilters);
    this._emitFilterChanged();
  }

  /**
   * Set a specific filter option
   */
  setFilter(dimension, option, value) {
    const filters = this._readFilters();
    if (!filters[dimension] || filters[dimension][option] === undefined) {
      console.warn(`[TaskFilterService] Invalid filter: ${dimension}.${option}`);
      return;
    }

    const nextFilters = JSON.parse(JSON.stringify(filters));
    nextFilters[dimension][option] = !!value;
    this._writeFilters(nextFilters);
    this._emitFilterChanged();
  }

  /**
   * Check if a feature passes the view filters
   * @param {Object} feature - Feature to check
   * @returns {boolean}
   */
  featurePassesFilters(feature) {
    const filters = this._readFilters();

    // Schedule filter
    const hasSchedule = !!(feature.start && feature.end);
    const scheduleOk =
      (hasSchedule && filters.schedule.planned) || (!hasSchedule && filters.schedule.unplanned);
    if (!scheduleOk) return false;

    // Allocation filter
    const hasAllocation =
      feature.capacity &&
      feature.capacity.length > 0 &&
      feature.capacity.some((c) => c && c.capacity && Number(c.capacity) > 0);
    const allocationOk =
      (hasAllocation && filters.allocation.allocated) || (!hasAllocation && filters.allocation.unallocated);
    if (!allocationOk) return false;

    // Hierarchy filter
    const hasParent = !!feature.parentId;
    const hierarchyOk =
      (hasParent && filters.hierarchy.hasParent) || (!hasParent && filters.hierarchy.noParent);
    if (!hierarchyOk) return false;

    // Relations filter
    const hasLinks = feature.relations && feature.relations.length > 0;
    const relationsOk =
      (hasLinks && filters.relations.hasLinks) || (!hasLinks && filters.relations.noLinks);
    if (!relationsOk) return false;

    return true;
  }

  /**
   * Restore filters from saved state
   */
  restoreFilters(savedFilters) {
    if (!savedFilters) return;

    // Merge saved filters with defaults
    const nextFilters = this._defaultFilters();
    Object.keys(nextFilters).forEach((dimension) => {
      if (savedFilters[dimension]) {
        Object.keys(nextFilters[dimension]).forEach((option) => {
          if (savedFilters[dimension][option] !== undefined) {
            nextFilters[dimension][option] = savedFilters[dimension][option];
          }
        });
      }
    });

    this._writeFilters(nextFilters);

    // Emit event to notify UI components to update
    this._emitFilterChanged();
  }

  /**
   * Emit filter change event
   */
  _emitFilterChanged() {
    this._env.events.emitFilterChanged(this.bus, { taskFilters: this._readFilters() });
    this._env.events.emitFeatureUpdated(this.bus, { ids: [] });
  }

  /**
   * Reset all filters to default (all checked)
   */
  resetFilters() {
    const defaults = this._defaultFilters();
    const current = this._readFilters();
    if (JSON.stringify(current) === JSON.stringify(defaults)) {
      return;
    }
    this._writeFilters(defaults);
    this._emitFilterChanged();
  }
}
