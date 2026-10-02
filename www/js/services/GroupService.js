/**
 * GroupService — manages plan-scoped task groups.
 *
 * Groups are fetched in batches and cached locally per plan.
 * Mutations (create / update / delete) go to the REST API and update the
 * local cache on success.
 *
 * Group membership is stored on the group: `group.members = [taskId, ...]`.
 * Per-scenario membership overrides are stored in `scenario.groupOverrides`.
 * Scenario-local groups (not yet promoted to baseline) live in `scenario.scenarioGroups`.
 *
 * Events emitted on the global bus:
 *   GroupEvents.LOADED   — groups for a plan fetched / refreshed
 *   GroupEvents.CHANGED  — group created / updated / deleted / membership changed
 *                         Pure signal only; consumers re-read current group state.
 *
 * Singleton exported as `groupService`.
 */

import { bus } from '../core/EventBus.js';
import { GroupEvents, SessionEvents } from '../core/EventRegistry.js';
import { dataService } from './dataService.js';
import { deriveEffectiveGroupsForPlan } from '../application/shared/groupProjection.js';

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

  /** Return all cached groups across all loaded plans. */
  getAllGroups() {
    const out = [];
    for (const groups of this._groupsByPlan.values()) out.push(...groups);
    return out;
  }

  /** Return true if any loaded plan has at least one group. */
  hasAnyGroups(planIds) {
    if (planIds) {
      return planIds.some((id) => (this._groupsByPlan.get(String(id)) || []).length > 0);
    }
    for (const groups of this._groupsByPlan.values()) {
      if (groups.length > 0) return true;
    }
    return false;
  }

  /** Find a cached group by id across all plans. */
  getGroupById(groupId) {
    for (const groups of this._groupsByPlan.values()) {
      const found = groups.find((g) => String(g.id) === String(groupId));
      if (found) return found;
    }
    return null;
  }

  /**
   * Return the effective groups for a plan, merging:
   *   1. Baseline groups from the server cache
   *   2. scenario.groupOverrides[groupId].members — per-scenario member overrides for baseline groups
   *   3. scenario.scenarioGroups — locally-created groups not yet promoted to baseline
   *
   * This is the authoritative read API for any code that needs to know "which
   * groups exist for this plan right now, with scenario-specific membership".
   *
   * The baseline cache is not mutated — overrides produce new group objects.
   *
   * @param {string|number} planId
  * @param {object} scenario  Active scenario object
   * @returns {Array} Effective groups sorted by (rank, name)
   */
  getEffectiveGroups(planId, scenario) {
    const key = String(planId);
    const baselineGroups = this._groupsByPlan.get(key) || [];
    return deriveEffectiveGroupsForPlan(planId, baselineGroups, scenario);
  }

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  /**
   * Fetch groups for a plan from the server, update the local cache, and
   * emit GroupEvents.LOADED.
   * @param {string} planId
   * @returns {Promise<Array>} The fetched groups; rejects when loading fails.
   */
  async loadGroups(planId) {
    const key = String(planId);
    let request = this._pendingLoads.get(key);
    if (!request) {
      this.evictPlan(key);
      request = this._startLoad([key], false);
    }
    await request.promise;
    return this.getGroupsForPlan(key);
  }

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
          request = this._startLoad([key], true);
        }
      }
      pending.add(request.promise);
    }
    await Promise.all(pending);
  }

  _startLoad(planIds, allPlans) {
    const request = { planIds: new Set(planIds), promise: Promise.resolve() };
    for (const key of planIds) this._pendingLoads.set(key, request);
    if (allPlans) this._batchRequest = request;
    const fetch = allPlans ? dataService.listGroups() : dataService.listGroups(planIds[0]);
    request.promise = fetch.then((groups) => {
      let changed = false;
      for (const key of request.planIds) {
        // Eviction or account changes revoke an old response's right to populate this plan.
        if (this._pendingLoads.get(key) !== request || this.hasPlanLoaded(key)) continue;
        this._groupsByPlan.set(key, groups.filter((group) => String(group.plan_id) === key));
        changed = true;
      }
      if (changed) bus.emit(GroupEvents.LOADED);
    }).catch((err) => {
      console.error('[GroupService] loadGroups error', planIds, err);
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

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Create a new group on the server and update the local cache.
   * @param {string} planId
   * @param {string} name
   * @param {{ color?:string, rank:number }} opts  `rank` is a sibling-scoped ordering key
   * @returns {Promise<object|null>}
   */
  async createGroup(planId, name, opts) {
    if (!Number.isInteger(opts.rank)) {
      throw new Error(`GroupService.createGroup: rank must be an integer for '${name}'`);
    }
    const payload = {
      plan_id: planId,
      name,
      ...(opts.color ? { color: opts.color } : {}),
      rank: opts.rank,
    };
    try {
      const group = await dataService.createGroup(payload);
      if (!group) return null;
      const list = this._groupsByPlan.get(String(planId)) || [];
      list.push(group);
      this._groupsByPlan.set(String(planId), list);
      bus.emit(GroupEvents.CHANGED);
      return group;
    } catch (err) {
      console.error('[GroupService] createGroup error', err);
      return null;
    }
  }

  /**
   * Update an existing group (name, color, rank).
   * @param {string} groupId
   * @param {{ name?:string, color?:string, rank?:number }} fields
   * @returns {Promise<object|null>}
   */
  async updateGroup(groupId, fields) {
    try {
      const updated = await dataService.updateGroup(groupId, fields);
      if (!updated) return null;
      for (const [planId, list] of this._groupsByPlan.entries()) {
        const idx = list.findIndex((g) => String(g.id) === String(groupId));
        if (idx !== -1) {
          list[idx] = updated;
          this._groupsByPlan.set(planId, list);
          break;
        }
      }
      bus.emit(GroupEvents.CHANGED);
      return updated;
    } catch (err) {
      console.error('[GroupService] updateGroup error', err);
      return null;
    }
  }

  /**
   * Delete a group (server cascades sub-groups).
   * @param {string} groupId
   * @returns {Promise<boolean>}
   */
  async deleteGroup(groupId) {
    try {
      const ok = await dataService.deleteGroup(groupId);
      if (!ok) return false;
      for (const [planId, list] of this._groupsByPlan.entries()) {
        const idx = list.findIndex((g) => String(g.id) === String(groupId));
        if (idx !== -1) {
          // Cascade: collect the deleted group and all its descendants.
          const toRemove = new Set([String(groupId)]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const g of list) {
              if (g.parent_id && toRemove.has(String(g.parent_id)) && !toRemove.has(String(g.id))) {
                toRemove.add(String(g.id));
                changed = true;
              }
            }
          }
          this._groupsByPlan.set(planId, list.filter((g) => !toRemove.has(String(g.id))));
          break;
        }
      }
      bus.emit(GroupEvents.CHANGED);
      return true;
    } catch (err) {
      console.error('[GroupService] deleteGroup error', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Local-only mutations (no REST calls)
  // These are used during editing so changes are deferred until the user
  // explicitly publishes them through the save dialog.
  // ---------------------------------------------------------------------------

  /**
   * Add a group to the local cache without hitting the server.
   * @param {string} planId
   * @param {object} group  Must have at least { id, plan_id, name }
   */
  addLocal(planId, group) {
    const list = this._groupsByPlan.get(String(planId)) || [];
    list.push(group);
    this._groupsByPlan.set(String(planId), list);
    bus.emit(GroupEvents.CHANGED);
  }

  /**
   * Update a group in the local cache without hitting the server.
   * @param {string} groupId
   * @param {object} fields  Partial fields to merge
   * @returns {object|null}  Updated group, or null if not found
   */
  updateLocal(groupId, fields) {
    for (const [planId, list] of this._groupsByPlan.entries()) {
      const idx = list.findIndex((g) => String(g.id) === String(groupId));
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...fields };
        this._groupsByPlan.set(planId, list);
        bus.emit(GroupEvents.CHANGED);
        return list[idx];
      }
    }
    return null;
  }

  /**
   * Remove a group from the local cache without hitting the server.
   * Also removes any sub-groups (groups whose parent_id matches the deleted group),
   * mirroring the cascade the server applies on deletion.
   * @param {string} groupId
   */
  removeLocal(groupId) {
    for (const [planId, list] of this._groupsByPlan.entries()) {
      const idx = list.findIndex((g) => String(g.id) === String(groupId));
      if (idx !== -1) {
        // Collect all descendant IDs (recursive cascade).
        const toRemove = new Set([String(groupId)]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const g of list) {
            if (g.parent_id && toRemove.has(String(g.parent_id)) && !toRemove.has(String(g.id))) {
              toRemove.add(String(g.id));
              changed = true;
            }
          }
        }
        this._groupsByPlan.set(planId, list.filter((g) => !toRemove.has(String(g.id))));
        bus.emit(GroupEvents.CHANGED);
        return;
      }
    }
  }

  /**
   * Remove all locally-created (temp) groups from every plan's cache.
   * Temp groups have IDs that start with 'tmp_'.  Call this when switching
   * scenarios so groups from a previous scenario don't bleed into the next one.
   * Emits a single GroupEvents.CHANGED so the board re-renders.
   */
  clearTempGroups() {
    let changed = false;
    for (const [planId, list] of this._groupsByPlan.entries()) {
      const filtered = list.filter((g) => !String(g.id).startsWith('tmp_'));
      if (filtered.length !== list.length) {
        this._groupsByPlan.set(planId, filtered);
        changed = true;
      }
    }
    if (changed) bus.emit(GroupEvents.CHANGED);
  }

  /**
   * Swap a temporary local ID for the real server-assigned ID after creation.
   * Updates the cache entry in place.
   * @param {string} tempId
   * @param {string} realId
   */
  replaceId(tempId, realId) {
    for (const [planId, list] of this._groupsByPlan.entries()) {
      const idx = list.findIndex((g) => String(g.id) === String(tempId));
      if (idx !== -1) {
        list[idx] = { ...list[idx], id: realId };
        this._groupsByPlan.set(planId, list);
        return;
      }
    }
  }

}

export const groupService = new GroupService();
