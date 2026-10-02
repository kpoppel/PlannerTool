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
import { store } from '../application/store.js';

export class GroupService {
  constructor(storeApi, dataServiceApi = dataService, eventBus = bus) {
    this._store = storeApi;
    this._dataService = dataServiceApi;
    this._bus = eventBus;
    this._pendingLoads = new Map();
    this._batchRequest = null;
    this._bus.on(SessionEvents.CHANGED, () => this.clear());
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /** Return all cached groups for a plan (synchronous, may be empty before load). */
  getGroupsForPlan(planId) {
    const groups = this._store.getState().groups.byPlanId[String(planId)];
    return groups === undefined ? [] : groups;
  }

  /**
   * Return true if the plan's groups have been loaded into the cache at least
   * once (even if the plan has zero groups).  Use this to distinguish
   * "never fetched" from "fetched and empty".
   * @param {string|number} planId
   * @returns {boolean}
   */
  hasPlanLoaded(planId) {
    return this._store.getState().groups.loadedPlanIds.includes(String(planId));
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
        if (this._batchRequest && !this._batchRequest.resolving
          && !this._batchRequest.revokedPlanIds.has(key)) {
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
    const request = {
      planIds: new Set(planIds),
      revokedPlanIds: new Set(),
      resolving: false,
      promise: Promise.resolve(),
    };
    for (const key of planIds) this._pendingLoads.set(key, request);
    this._batchRequest = request;
    request.promise = this._dataService.listGroups().then((result) => {
      if (!result.ok) {
        throw new Error(`Failed to load groups: ${result.error.message}`);
      }

      request.resolving = true;
      let changed = false;
      this._store.setState(
        (state) => {
          const byPlanId = { ...state.groups.byPlanId };
          const loadedPlanIds = [...state.groups.loadedPlanIds];
          for (const key of request.planIds) {
            // Eviction or account changes revoke an old response's right to populate this plan.
            if (this._pendingLoads.get(key) !== request || loadedPlanIds.includes(key)) continue;
            byPlanId[key] = result.data.filter((group) => String(group.plan_id) === key);
            loadedPlanIds.push(key);
            changed = true;
          }
          if (!changed) return state;
          return {
            ...state,
            groups: { ...state.groups, byPlanId, loadedPlanIds },
          };
        },
        false,
        'group.loadGroupsForPlans'
      );
      if (changed) this._bus.emit(GroupEvents.LOADED);
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
    const request = this._pendingLoads.get(key);
    if (request) request.revokedPlanIds.add(key);
    this._pendingLoads.delete(key);
    this._store.setState(
      (state) => {
        const byPlanId = { ...state.groups.byPlanId };
        delete byPlanId[key];
        return {
          ...state,
          groups: {
            ...state.groups,
            byPlanId,
            loadedPlanIds: state.groups.loadedPlanIds.filter((id) => id !== key),
          },
        };
      },
      false,
      'group.evictPlan'
    );
    this._bus.emit(GroupEvents.CHANGED);
  }

  /** Clear account-local state and invalidate every outstanding response. */
  clear() {
    this._pendingLoads.clear();
    this._batchRequest = null;
    this._store.setState(
      (state) => ({
        ...state,
        groups: { ...state.groups, byPlanId: {}, loadedPlanIds: [] },
      }),
      false,
      'group.clear'
    );
    this._bus.emit(GroupEvents.CHANGED);
  }
}

export const groupService = new GroupService(store);
