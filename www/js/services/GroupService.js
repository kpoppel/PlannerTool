/**
 * GroupService — manages plan-scoped task groups.
 *
 * Groups are fetched from the server once per plan and cached locally.
 * Mutations (create / update / delete) go to the REST API and update the
 * local cache on success.
 *
 * Group assignment (which feature belongs to which group) is stored as a
 * scenario override (feature.groupId) via State.updateFeatureField so it
 * participates in the normal scenario save / annotate flow.
 *
 * Events emitted on the global bus:
 *   GroupEvents.LOADED            — groups for a plan fetched / refreshed
 *   GroupEvents.CHANGED           — group created / updated / deleted
 *   GroupEvents.ASSIGNMENT_CHANGED — feature groupId override changed
 *
 * Singleton exported as `groupService`.
 */

import { bus } from '../core/EventBus.js';
import { GroupEvents } from '../core/EventRegistry.js';
import { dataService } from './dataService.js';

export class GroupService {
  constructor() {
    /** @type {Map<string, Array>} planId → groups array */
    this._groupsByPlan = new Map();
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /** Return all cached groups for a plan (synchronous, may be empty before load). */
  getGroupsForPlan(planId) {
    return this._groupsByPlan.get(String(planId)) || [];
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

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  /**
   * Fetch groups for a plan from the server, update the local cache, and
   * emit GroupEvents.LOADED.
   * @param {string} planId
   * @returns {Promise<Array>}
   */
  async loadGroups(planId) {
    try {
      const groups = await dataService.listGroups(planId);
      this._groupsByPlan.set(String(planId), groups || []);
      bus.emit(GroupEvents.LOADED, { planId, groups: this._groupsByPlan.get(String(planId)) });
      return this._groupsByPlan.get(String(planId));
    } catch (err) {
      console.error('[GroupService] loadGroups error', planId, err);
      return [];
    }
  }

  /** Evict the cache for a plan (e.g. when the plan is deselected). */
  evictPlan(planId) {
    this._groupsByPlan.delete(String(planId));
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Create a new group on the server and update the local cache.
   * @param {string} planId
   * @param {string} name
   * @param {{ color?:string, rank?:number }} [opts]
   * @returns {Promise<object|null>}
   */
  async createGroup(planId, name, opts = {}) {
    const payload = {
      plan_id: planId,
      name,
      ...(opts.color ? { color: opts.color } : {}),
      rank: opts.rank ?? 0,
    };
    try {
      const group = await dataService.createGroup(payload);
      if (!group) return null;
      const list = this._groupsByPlan.get(String(planId)) || [];
      list.push(group);
      this._groupsByPlan.set(String(planId), list);
      bus.emit(GroupEvents.CHANGED, { op: 'created', group });
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
      bus.emit(GroupEvents.CHANGED, { op: 'updated', group: updated });
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
          this._groupsByPlan.set(planId, list.filter((g) => String(g.id) !== String(groupId)));
          break;
        }
      }
      bus.emit(GroupEvents.CHANGED, { op: 'deleted', groupId });
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
    bus.emit(GroupEvents.CHANGED, { op: 'created', group });
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
        bus.emit(GroupEvents.CHANGED, { op: 'updated', group: list[idx] });
        return list[idx];
      }
    }
    return null;
  }

  /**
   * Remove a group from the local cache without hitting the server.
   * @param {string} groupId
   */
  removeLocal(groupId) {
    for (const [planId, list] of this._groupsByPlan.entries()) {
      const idx = list.findIndex((g) => String(g.id) === String(groupId));
      if (idx !== -1) {
        this._groupsByPlan.set(planId, list.filter((g) => String(g.id) !== String(groupId)));
        bus.emit(GroupEvents.CHANGED, { op: 'deleted', groupId });
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
    if (changed) bus.emit(GroupEvents.CHANGED, { op: 'cleared' });
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

  /**
   * Assign a feature to a group (or remove it from all groups when groupId is null).
   * Stored as a scenario override via State.updateFeatureField so it participates
   * in the normal save flow.
   *
   * @param {string} featureId
   * @param {string|null} groupId  null = ungrouped
   * @param {import('./State.js').State} stateRef
   */
  assignFeature(featureId, groupId, stateRef) {
    stateRef.updateFeatureField(featureId, 'groupId', groupId ?? null);
    bus.emit(GroupEvents.ASSIGNMENT_CHANGED, { featureId, groupId: groupId ?? null });
  }
}

export const groupService = new GroupService();
