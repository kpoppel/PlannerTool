/**
 * Module: SummaryGroupService
 * Intent: In-memory store for plan summary groups used in swimlane/plan-overview mode.
 *
 * A SummaryGroup is a virtual grouping of features displayed as a single summary bar
 * that shrink-wraps its members' date range. Groups are local to the browser session
 * (not persisted server-side in this iteration).
 *
 * @typedef {{ id: string, title: string, projectId: string|number, memberIds: Set<string>, collapsed: boolean }} SummaryGroup
 */

import { bus } from '../core/EventBus.js';
import { PlanSummaryEvents } from '../core/EventRegistry.js';

let _nextId = 1;
function _generateId() {
  return `sg-${_nextId++}-${Date.now()}`;
}

/** Distinct colors assigned round-robin to new groups (Material 300 palette). */
const GROUP_COLORS = [
  '#e57373', // red
  '#4fc3f7', // light blue
  '#81c784', // green
  '#ffb74d', // orange
  '#ba68c8', // purple
  '#4dd0e1', // cyan
  '#f06292', // pink
  '#aed581', // light green
  '#ffd54f', // amber
  '#90a4ae', // blue-grey
];
let _colorIndex = 0;

/** @type {Map<string, SummaryGroup>} */
const _groups = new Map();

/** Lookup: featureId -> groupId for efficient membership queries */
const _memberIndex = new Map();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _rebuildMemberIndex() {
  _memberIndex.clear();
  for (const [groupId, group] of _groups) {
    for (const memberId of group.memberIds) {
      _memberIndex.set(String(memberId), groupId);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const summaryGroupService = {
  /**
   * Return all groups, optionally filtered by projectId.
   * @param {string|number} [projectId]
   * @returns {SummaryGroup[]}
   */
  getGroups(projectId) {
    const all = Array.from(_groups.values());
    if (projectId === undefined || projectId === null) return all;
    return all.filter((g) => String(g.projectId) === String(projectId));
  },

  /**
   * Return the group that contains the given featureId, or null if none.
   * @param {string|number} featureId
   * @returns {SummaryGroup|null}
   */
  getGroupForFeature(featureId) {
    const groupId = _memberIndex.get(String(featureId));
    return groupId ? (_groups.get(groupId) ?? null) : null;
  },

  /**
   * Create a new group from a set of feature IDs belonging to the same project.
   * If any of the provided featureIds already belong to a group, they are first
   * removed from their existing groups before being added to the new one.
   * @param {(string|number)[]} memberIds
   * @param {string|number} projectId
   * @param {string} [title]
   * @returns {SummaryGroup}
   */
  createGroup(memberIds, projectId, title) {
    const id = _generateId();
    const memberSet = new Set(memberIds.map(String));

    // Remove members from any existing groups
    for (const memberId of memberSet) {
      const existingGroupId = _memberIndex.get(memberId);
      if (existingGroupId) {
        const existing = _groups.get(existingGroupId);
        if (existing) {
          existing.memberIds.delete(memberId);
          if (existing.memberIds.size === 0) {
            // Dissolve empty group silently
            _groups.delete(existingGroupId);
          }
        }
      }
    }

    const group = {
      id,
      title: title ?? `Group ${_nextId - 1}`,
      projectId: String(projectId),
      memberIds: memberSet,
      collapsed: true, // collapse immediately so member cards are hidden on creation
      color: GROUP_COLORS[_colorIndex++ % GROUP_COLORS.length],
    };
    _groups.set(id, group);
    _rebuildMemberIndex();

    bus.emit(PlanSummaryEvents.GROUP_CREATED, _serializeGroup(group));
    return group;
  },

  /**
   * Add a feature to an existing group.
   * If the feature already belongs to another group it is moved.
   * @param {string} groupId
   * @param {string|number} featureId
   */
  addMember(groupId, featureId) {
    const group = _groups.get(groupId);
    if (!group) return;
    const fid = String(featureId);

    // Remove from existing group first
    const existingGroupId = _memberIndex.get(fid);
    if (existingGroupId && existingGroupId !== groupId) {
      const existing = _groups.get(existingGroupId);
      if (existing) {
        existing.memberIds.delete(fid);
        if (existing.memberIds.size === 0) _groups.delete(existingGroupId);
      }
    }

    group.memberIds.add(fid);
    _rebuildMemberIndex();
    bus.emit(PlanSummaryEvents.GROUP_UPDATED, _serializeGroup(group));
  },

  /**
   * Remove a feature from its group.
   * If the group becomes empty it is dissolved automatically.
   * @param {string|number} featureId
   */
  removeMember(featureId) {
    const fid = String(featureId);
    const groupId = _memberIndex.get(fid);
    if (!groupId) return;
    const group = _groups.get(groupId);
    if (!group) return;

    group.memberIds.delete(fid);
    _memberIndex.delete(fid);

    if (group.memberIds.size === 0) {
      _groups.delete(groupId);
      bus.emit(PlanSummaryEvents.GROUP_DISSOLVED, { id: groupId });
    } else {
      bus.emit(PlanSummaryEvents.GROUP_UPDATED, _serializeGroup(group));
    }
  },

  /**
   * Dissolve a group entirely, releasing all its members.
   * @param {string} groupId
   */
  dissolveGroup(groupId) {
    const group = _groups.get(groupId);
    if (!group) return;
    for (const memberId of group.memberIds) {
      _memberIndex.delete(memberId);
    }
    _groups.delete(groupId);
    bus.emit(PlanSummaryEvents.GROUP_DISSOLVED, { id: groupId });
  },

  /**
   * Rename a group.
   * @param {string} groupId
   * @param {string} title
   */
  setTitle(groupId, title) {
    const group = _groups.get(groupId);
    if (!group) return;
    group.title = title;
    bus.emit(PlanSummaryEvents.GROUP_UPDATED, _serializeGroup(group));
  },

  /**
   * Collapse or expand a group.
   * @param {string} groupId
   * @param {boolean} collapsed
   */
  setCollapsed(groupId, collapsed) {
    const group = _groups.get(groupId);
    if (!group) return;
    group.collapsed = !!collapsed;
    bus.emit(PlanSummaryEvents.GROUP_UPDATED, _serializeGroup(group));
  },

  /**
   * Clear all groups. Used when exiting plan summary mode.
   */
  clearAll() {
    _groups.clear();
    _memberIndex.clear();
  },
};

/**
 * Serialize a group to a plain object for event payloads (converts Set to Array).
 * @param {SummaryGroup} group
 * @returns {Object}
 */
function _serializeGroup(group) {
  return {
    id: group.id,
    title: group.title,
    projectId: group.projectId,
    memberIds: Array.from(group.memberIds),
    collapsed: group.collapsed,
    color: group.color,
  };
}
