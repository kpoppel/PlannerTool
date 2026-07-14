/**
 * GroupService — manages plan-scoped task groups.
 *
 * Groups are fetched from the server once per plan and cached locally.
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
 *
 * Singleton exported as `groupService`.
 */

import { bus } from '../core/EventBus.js';
import { GroupEvents } from '../core/EventRegistry.js';
import { dataService } from './dataService.js';
import { dataOr } from './result.js';

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
   * @param {object|null} scenario  Active scenario (may be null/undefined)
   * @returns {Array} Effective groups sorted by (rank, name)
   */
  getEffectiveGroups(planId, scenario) {
    const key = String(planId);
    const baselineGroups = this._groupsByPlan.get(key) || [];
    const groupOverrides = scenario?.groupOverrides || {};
    const scenarioGroups = (scenario?.scenarioGroups || []).filter(
      (g) => String(g.plan_id) === key
    );

    // Apply group overrides to baseline groups (non-destructively).
    // Groups marked as deleted are excluded.
    const effective = baselineGroups
      .filter((g) => !groupOverrides[String(g.id)]?._deleted)
      .map((g) => {
        const ov = groupOverrides[String(g.id)];
        if (!ov) return g;
        // Apply scalar field overrides (name, color, etc) then reconstruct members from deltas.
        const { _deleted, memberDeltas, ...fields } = ov;
        let members = g.members || [];
        if (memberDeltas?.length) {
          const memberSet = new Set(members.map(String));
          for (const { taskId, op } of memberDeltas) {
            if (op === 'add') memberSet.add(String(taskId));
            else memberSet.delete(String(taskId));
          }
          members = [...memberSet];
        }
        return { ...g, ...fields, members };
      });

    // Append scenario-local groups (already scoped to planId by filter above).
    return [...effective, ...scenarioGroups];
  }

  /**
   * Add a task to a group's member list.
   *
   * For scenario-local groups (id starts with 'tmp_' or found in scenarioGroups):
   *   updates members in-place on the scenarioGroups entry.
   * For baseline groups:
   *   calls stateRef.setGroupMembersOverride to record the change as a scenario override.
   *
   * @param {string} groupId
   * @param {string} taskId
   * @param {{ getActiveScenario: () => object, setGroupMembersOverride?: (id:string, members:string[]) => void }} stateRef
   */
  addMemberToGroup(groupId, taskId, stateRef) {
    const scenario = stateRef?.getActiveScenario?.();
    if (!scenario) return;

    // Check scenario-local groups first
    const sgIdx = (scenario.scenarioGroups || []).findIndex(
      (g) => String(g.id) === String(groupId)
    );
    if (sgIdx !== -1) {
      const sg = scenario.scenarioGroups[sgIdx];
      if (!Array.isArray(sg.members)) sg.members = [];
      if (!sg.members.includes(String(taskId))) {
        sg.members = [...sg.members, String(taskId)];
        stateRef.markGroupChanged?.();
      }
      bus.emit(GroupEvents.CHANGED, { op: 'memberAdded', groupId, taskId });
      return;
    }

    // Baseline group — record as a delta in groupOverrides
    const baseGroup = this.getGroupById(groupId);
    if (baseGroup) {
      // Idempotency: skip if already a member (check effective state)
      const effMembers = (scenario.groupOverrides?.[groupId]?.memberDeltas || [])
        .reduce((set, d) => {
          if (d.op === 'add') set.add(String(d.taskId));
          else set.delete(String(d.taskId));
          return set;
        }, new Set((baseGroup.members || []).map(String)));
      if (!effMembers.has(String(taskId))) {
        stateRef.applyGroupMemberDelta?.(String(groupId), String(taskId), 'add');
        bus.emit(GroupEvents.CHANGED, { op: 'memberAdded', groupId, taskId });
      }
    }
  }

  /**
   * Remove a task from a group's member list.
   *
   * @param {string} groupId
   * @param {string} taskId
   * @param {{ getActiveScenario: () => object, setGroupMembersOverride?: (id:string, members:string[]) => void }} stateRef
   */
  removeMemberFromGroup(groupId, taskId, stateRef) {
    const scenario = stateRef?.getActiveScenario?.();
    if (!scenario) return;

    // Check scenario-local groups first
    const sgIdx = (scenario.scenarioGroups || []).findIndex(
      (g) => String(g.id) === String(groupId)
    );
    if (sgIdx !== -1) {
      const sg = scenario.scenarioGroups[sgIdx];
      sg.members = (sg.members || []).filter((m) => String(m) !== String(taskId));
      stateRef.markGroupChanged?.();
      bus.emit(GroupEvents.CHANGED, { op: 'memberRemoved', groupId, taskId });
      return;
    }

    // Baseline group — record as a delta in groupOverrides
    const baseGroup = this.getGroupById(groupId);
    if (baseGroup) {
      stateRef.applyGroupMemberDelta?.(String(groupId), String(taskId), 'remove');
      bus.emit(GroupEvents.CHANGED, { op: 'memberRemoved', groupId, taskId });
    }
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
      const groups = dataOr(await dataService.listGroups(planId), []);
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
      const group = dataOr(await dataService.createGroup(payload), null);
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
      const updated = dataOr(await dataService.updateGroup(groupId, fields), null);
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
      const ok = dataOr(await dataService.deleteGroup(groupId), false);
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

}

export const groupService = new GroupService();
