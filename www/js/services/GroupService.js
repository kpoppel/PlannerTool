/**
 * GroupService — loads and caches baseline groups per plan.
 *
 * Groups are fetched in batches and cached locally per plan.
 * Scenario edits belong to application commands and selectors; publishing
 * refreshes affected plans through this cache.
 *
 * Group membership is stored on the group: `group.members = [taskId, ...]`.
 * Per-scenario membership overrides are stored in `scenario.groupOverrides`.
 * Scenario-local groups (not yet promoted to baseline) live in `scenario.scenarioGroups`.
 *
 * Events emitted on the global bus:
 *   GroupEvents.LOADED   — groups for a plan fetched / refreshed
 *   GroupEvents.CHANGED  — account-local baseline cache cleared
 *                         Pure signal only; consumers re-read current group state.
 *
 * Singleton exported as `groupService`.
 */

import { bus } from '../core/EventBus.js';
import { GroupEvents, SessionEvents } from '../core/EventRegistry.js';
import { dataService } from './dataService.js';

export class GroupService {
  constructor() {
    /** @type {Map<string, Array>} planId → groups array */
    this._groupsByPlan = new Map();
    this._pendingLoads = new Map();
    this._batchRequest = null;
    bus.on(SessionEvents.CHANGED, () => this.clear());
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /** Return all cached groups for a plan (synchronous, may be empty before load). */
  getGroupsForPlan(planId) {
    return this._groupsByPlan.get(String(planId)) || [];
  }

  /**
   * Return true if the plan's groups have been loaded into the cache at least
   * once (even if the plan has zero groups).  Use this to distinguish
   * "never fetched" from "fetched and empty".
   * @param {string|number} planId
   * @returns {boolean}
   */
  hasPlanLoaded(planId) {
    return this._groupsByPlan.has(String(planId));
  }

  /** Find a cached group by id across all plans. */
  getGroupById(groupId) {
    for (const groups of this._groupsByPlan.values()) {
      const found = groups.find((g) => String(g.id) === String(groupId));
      if (found) return found;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  /** Fetch missing plans together, sharing an active batch within this application. */
  async loadGroupsForPlans(planIds) {
    const pending = new Set();
    for (const planId of planIds) {
      const key = String(planId);
      if (this.hasPlanLoaded(key)) continue;
      let request = this._pendingLoads.get(key);
      if (!request) {
        if (this._batchRequest) {
          request = this._batchRequest;
          request.planIds.add(key);
          this._pendingLoads.set(key, request);
        } else {
          request = this._startLoad([key]);
        }
      }
      pending.add(request.promise);
    }
    await Promise.all(pending);
  }

  _startLoad(planIds) {
    const request = { planIds: new Set(planIds), promise: Promise.resolve() };
    for (const key of planIds) this._pendingLoads.set(key, request);
    this._batchRequest = request;
    request.promise = dataService.listGroups().then((groups) => {
      let changed = false;
      for (const key of request.planIds) {
        // Eviction or account changes revoke an old response's right to populate this plan.
        if (this._pendingLoads.get(key) !== request || this.hasPlanLoaded(key)) continue;
        this._groupsByPlan.set(key, groups.filter((group) => String(group.plan_id) === key));
        changed = true;
      }
      if (changed) bus.emit(GroupEvents.LOADED);
    }).catch((err) => {
      console.error('[GroupService] loadGroupsForPlans error', planIds, err);
      throw err;
    }).finally(() => {
      for (const key of request.planIds) {
        if (this._pendingLoads.get(key) === request) this._pendingLoads.delete(key);
      }
      if (this._batchRequest === request) this._batchRequest = null;
    });
    return request;
  }

  /** Evict the cache for a plan (e.g. when the plan is deselected). */
  evictPlan(planId) {
    const key = String(planId);
    this._groupsByPlan.delete(key);
    this._pendingLoads.delete(key);
    if (this._batchRequest && this._batchRequest.planIds.has(key)) this._batchRequest = null;
  }

  /** Clear account-local state and invalidate every outstanding response. */
  clear() {
    this._groupsByPlan.clear();
    this._pendingLoads.clear();
    this._batchRequest = null;
    bus.emit(GroupEvents.CHANGED);
  }
}

export const groupService = new GroupService();
