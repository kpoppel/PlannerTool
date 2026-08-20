import { GroupEvents, ScenarioEvents } from '../../core/EventRegistry.js';
import {
  getActiveScenario,
  getActiveScenarioId,
  getScenarioItems,
  isMutableScenario,
  withActiveScenario,
} from '../shared/scenarioMutations.js';
import { deriveEffectiveGroupsForPlan } from '../shared/groupProjection.js';
import { computeInsertRank } from '../shared/ordering.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */

function applyGroupMemberDeltaToScenario(scenario, groupId, taskId, op) {
  const key = String(groupId);
  const nextOverrides = { ...scenario.groupOverrides };
  const current = nextOverrides[key] === undefined ? {} : nextOverrides[key];
  const existingMemberDeltas = current.memberDeltas === undefined ? [] : current.memberDeltas;
  const nextDeltas = existingMemberDeltas.filter(
    (entry) => String(entry.taskId) !== String(taskId)
  );
  nextDeltas.push({ taskId: String(taskId), op });

  nextOverrides[key] = {
    ...current,
    memberDeltas: nextDeltas,
  };

  return {
    ...scenario,
    groupOverrides: nextOverrides,
  };
}

/** Mark the active (non-baseline) scenario as having unsaved changes. */
function addActiveScenarioToChangedIds(state) {
  const activeId = getActiveScenarioId(state);
  if (activeId === 'baseline') return state.scenarios.changedIds;
  return Array.from(new Set([...state.scenarios.changedIds, String(activeId)]));
}

function emitGroupMutation(bus, store, payload) {
  void store;
  void payload;
  bus.emit(GroupEvents.CHANGED);
  bus.emit(ScenarioEvents.UPDATED);
}

function buildTempGroupId() {
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Merge `fields` into one group inside a scenario, writing to `scenarioGroups`
 * for locally-created groups and to `groupOverrides` for baseline groups.
 */
function applyGroupFieldsToScenario(scenario, groupId, fields) {
  const scenarioGroups = scenario.scenarioGroups;
  const localIndex = scenarioGroups.findIndex((group) => String(group.id) === String(groupId));
  if (localIndex !== -1) {
    const nextScenarioGroups = [...scenarioGroups];
    nextScenarioGroups[localIndex] = {
      ...nextScenarioGroups[localIndex],
      ...fields,
    };
    return {
      ...scenario,
      scenarioGroups: nextScenarioGroups,
    };
  }

  const nextOverrides = { ...scenario.groupOverrides };
  nextOverrides[String(groupId)] = {
    ...(nextOverrides[String(groupId)] === undefined ? {} : nextOverrides[String(groupId)]),
    ...fields,
  };

  return {
    ...scenario,
    groupOverrides: nextOverrides,
  };
}

function parentKey(parentId) {
  if (parentId === null || parentId === undefined || parentId === '') return '';
  return String(parentId);
}

function effectiveGroupsForPlan(state, planId) {
  const byPlanId = state.groups.byPlanId;
  const baselineGroups = byPlanId[String(planId)] === undefined ? [] : byPlanId[String(planId)];
  return deriveEffectiveGroupsForPlan(planId, baselineGroups, getActiveScenario(state));
}

function collectDescendantIds(groups, groupId) {
  const descendants = new Set([String(groupId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      const parentId = group.parent_id;
      if (!parentId) continue;
      if (!descendants.has(String(parentId))) continue;
      if (descendants.has(String(group.id))) continue;
      descendants.add(String(group.id));
      changed = true;
    }
  }
  return descendants;
}

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @returns {object}
 */
export function createGroupCommands(store, bus) {
  const commands = {
    /**
     * Create a group at the position the board insertion slot resolved.
     * @param {string} planId
     * @param {string} name
     * @param {string|null} color
     * @param {string|null} parentId  Parent group, null for the board root
     * @param {number} rank  Key on the shared group/task ordering scale
     * @param {{ id: string, rank: number }[]} [rankUpdates]  Siblings respaced to make room
     */
    createGroupInScenario(planId, name, color, parentId, rank, rankUpdates = []) {
      const safeName = String(name).trim();
      if (!planId || !safeName) return null;
      if (!Number.isInteger(rank)) {
        throw new Error(`createGroupInScenario: rank must be an integer for '${safeName}'`);
      }

      const snapshot = store.getState();
      if (!isMutableScenario(getActiveScenario(snapshot))) return null;

      const tempGroup = {
        id: buildTempGroupId(),
        plan_id: String(planId),
        name: safeName,
        rank,
        members: [],
        color,
        parent_id: parentId,
      };

      const mutation = withActiveScenario(snapshot, (scenario) => {
        const reranked = rankUpdates.reduce(
          (acc, update) => applyGroupFieldsToScenario(acc, update.id, { rank: update.rank }),
          scenario
        );
        return {
          ...reranked,
          scenarioGroups: [...reranked.scenarioGroups, tempGroup],
        };
      }, { allowBaseline: false });

      if (!mutation) return null;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'group.createGroupInScenario'
      );

      emitGroupMutation(bus, store, { op: 'created', groupId: tempGroup.id, planId: tempGroup.plan_id });
      return tempGroup;
    },

    updateGroupInScenario(groupId, fields) {
      if (!groupId || !fields || typeof fields !== 'object') return null;

      const snapshot = store.getState();
      const mutation = withActiveScenario(
        snapshot,
        (scenario) => applyGroupFieldsToScenario(scenario, groupId, fields),
        { allowBaseline: false }
      );

      if (!mutation) return null;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'group.updateGroupInScenario'
      );

      emitGroupMutation(bus, store, { op: 'updated', groupId: String(groupId) });
      return true;
    },

    /**
     * Re-rank and/or re-parent a group in the active scenario.
     *
     * @param {string} groupId
      * @param {{
      *   parentId: string|null,
      *   afterGroupId?: string|null,
      *   rank?: number,
      *   rankUpdates?: { id: string, rank: number }[]
      * }} placement
     */
    moveGroupInScenario(groupId, placement) {
      if (!groupId || !placement || typeof placement !== 'object') return false;

      const snapshot = store.getState();
      const scenario = getActiveScenario(snapshot);
      if (!isMutableScenario(scenario)) return false;

      const requestedParentId =
        placement.parentId === null || placement.parentId === undefined || placement.parentId === ''
          ? null
          : String(placement.parentId);
      const requestedAfterId =
        placement.afterGroupId === null || placement.afterGroupId === undefined
          ? null
          : String(placement.afterGroupId);
      const directRank = placement.rank;
      const directRankUpdates = placement.rankUpdates === undefined ? [] : placement.rankUpdates;

      const candidatePlanIds = new Set(Object.keys(snapshot.groups.byPlanId));
      for (const localGroup of scenario.scenarioGroups) {
        candidatePlanIds.add(String(localGroup.plan_id));
      }

      let planId = null;
      let effectiveGroups = [];
      let targetGroup = null;
      for (const candidatePlanId of candidatePlanIds) {
        const groups = effectiveGroupsForPlan(snapshot, candidatePlanId);
        const found = groups.find((group) => String(group.id) === String(groupId));
        if (!found) continue;
        planId = String(candidatePlanId);
        effectiveGroups = groups;
        targetGroup = found;
        break;
      }

      if (!targetGroup || !planId) return false;

      const descendants = collectDescendantIds(effectiveGroups, groupId);
      if (requestedParentId !== null && descendants.has(String(requestedParentId))) {
        throw new Error('moveGroupInScenario: cannot move a group into itself or its descendant');
      }

      if (requestedParentId !== null) {
        const parent = effectiveGroups.find((group) => String(group.id) === requestedParentId);
        if (!parent) {
          throw new Error(`moveGroupInScenario: parent '${requestedParentId}' was not found`);
        }
        if (String(parent.plan_id) !== planId) {
          throw new Error('moveGroupInScenario: parent must belong to the same plan');
        }
      }

      const siblings = effectiveGroups
        .filter((group) => String(group.id) !== String(groupId))
        .filter((group) => parentKey(group.parent_id) === parentKey(requestedParentId));

      let rank = directRank;
      let rebalance = directRankUpdates;
      if (!Number.isInteger(rank)) {
        if (
          requestedAfterId !== null
          && !siblings.some((sibling) => String(sibling.id) === requestedAfterId)
        ) {
          throw new Error(`moveGroupInScenario: afterGroupId '${requestedAfterId}' is not a sibling`);
        }

        const computed = computeInsertRank(
          siblings.map((group) => ({ id: group.id, rank: group.rank })),
          requestedAfterId
        );
        rank = computed.rank;
        rebalance = computed.rebalance;
      }
      if (!Number.isInteger(rank)) {
        throw new Error(`moveGroupInScenario: rank must be an integer for '${String(groupId)}'`);
      }

      const mutation = withActiveScenario(snapshot, (activeScenario) => {
        let nextScenario = activeScenario;
        for (const update of rebalance) {
          nextScenario = applyGroupFieldsToScenario(nextScenario, update.id, { rank: update.rank });
        }
        return applyGroupFieldsToScenario(nextScenario, groupId, {
          parent_id: requestedParentId,
          rank,
        });
      }, { allowBaseline: false });

      if (!mutation) return false;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'group.moveGroupInScenario'
      );

      emitGroupMutation(bus, store, {
        op: 'moved',
        groupId: String(groupId),
        planId,
        parentId: requestedParentId,
      });
      return true;
    },

    deleteGroupInScenario(groupId) {
      if (!groupId) return false;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => {
        const scenarioGroups = scenario.scenarioGroups;
        const localIds = new Set(scenarioGroups.map((group) => String(group.id)));

        if (localIds.has(String(groupId))) {
          const toRemove = new Set([String(groupId)]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const group of scenarioGroups) {
              if (
                group.parent_id &&
                toRemove.has(String(group.parent_id)) &&
                !toRemove.has(String(group.id))
              ) {
                toRemove.add(String(group.id));
                changed = true;
              }
            }
          }

          return {
            ...scenario,
            scenarioGroups: scenarioGroups.filter((group) => !toRemove.has(String(group.id))),
          };
        }

        const nextOverrides = { ...scenario.groupOverrides };
        nextOverrides[String(groupId)] = {
          ...(nextOverrides[String(groupId)] === undefined ? {} : nextOverrides[String(groupId)]),
          _deleted: true,
        };

        return {
          ...scenario,
          groupOverrides: nextOverrides,
        };
      }, { allowBaseline: false });

      if (!mutation) return false;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'group.deleteGroupInScenario'
      );

      emitGroupMutation(bus, store, { op: 'deleted', groupId: String(groupId) });
      return true;
    },

    applyGroupMemberDelta(groupId, taskId, op) {
      if (!groupId || !taskId || (op !== 'add' && op !== 'remove')) return false;

      const snapshot = store.getState();
      const mutation = withActiveScenario(
        snapshot,
        (scenario) => applyGroupMemberDeltaToScenario(scenario, groupId, taskId, op),
        { allowBaseline: false }
      );

      if (!mutation) return false;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addActiveScenarioToChangedIds(state),
            items: mutation.items,
          },
        }),
        false,
        'group.applyGroupMemberDelta'
      );

      emitGroupMutation(bus, store, {
        op: 'memberDelta',
        groupId: String(groupId),
        taskId: String(taskId),
        delta: op,
      });
      return true;
    },

    addMemberToGroup(groupId, taskId) {
      if (!groupId) return false;
      if (!taskId) return false;

      const snapshot = store.getState();
      const scenario = getActiveScenario(snapshot);
      if (!isMutableScenario(scenario)) return false;

      const localGroup = scenario.scenarioGroups.find(
        (group) => String(group.id) === String(groupId)
      );

      if (localGroup) {
        const hasMember = localGroup.members.some(
          (memberId) => String(memberId) === String(taskId)
        );
        if (hasMember) return true;

        return Boolean(
          commands.updateGroupInScenario(groupId, {
            members: [...localGroup.members, String(taskId)],
          })
        );
      }

      return commands.applyGroupMemberDelta(groupId, taskId, 'add');
    },

    removeMemberFromGroup(groupId, taskId) {
      if (!groupId) return false;
      if (!taskId) return false;

      const snapshot = store.getState();
      const scenario = getActiveScenario(snapshot);
      if (!isMutableScenario(scenario)) return false;

      const localGroup = scenario.scenarioGroups.find(
        (group) => String(group.id) === String(groupId)
      );

      if (localGroup) {
        const nextMembers = localGroup.members.filter(
          (memberId) => String(memberId) !== String(taskId)
        );
        return Boolean(commands.updateGroupInScenario(groupId, { members: nextMembers }));
      }

      return commands.applyGroupMemberDelta(groupId, taskId, 'remove');
    },

    clearPendingGroupChanges() {
      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => ({
        ...scenario,
        scenarioGroups: [],
        groupOverrides: {},
      }), { allowBaseline: false });

      if (!mutation) return false;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: mutation.items,
          },
        }),
        false,
        'group.clearPendingGroupChanges'
      );

      emitGroupMutation(bus, store, { op: 'clearedPending' });
      return true;
    },

    /**
     * Move a scenario-local group into the baseline after it has been created
     * on the server: drop it from `scenarioGroups` and re-queue any members the
     * user left uncommitted as pending deltas against the real group id.
     *
     * Without this the published group stays pending and is created again on
     * the next save, which is how duplicate groups accumulate on a plan.
     *
     * @param {string} tempId
     * @param {string} realId
     * @param {string[]} [uncommittedMemberIds]
     */
    promoteGroupToBaseline(tempId, realId, uncommittedMemberIds = []) {
      if (!tempId || !realId) return false;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => {
        const scenarioGroups = scenario.scenarioGroups.filter(
          (group) => String(group.id) !== String(tempId) && String(group.id) !== String(realId)
        );
        if (uncommittedMemberIds.length === 0) {
          return { ...scenario, scenarioGroups };
        }
        return uncommittedMemberIds.reduce(
          (acc, taskId) => applyGroupMemberDeltaToScenario(acc, realId, taskId, 'add'),
          { ...scenario, scenarioGroups }
        );
      }, { allowBaseline: false });

      if (!mutation) return false;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: mutation.items,
          },
        }),
        false,
        'group.promoteGroupToBaseline'
      );

      emitGroupMutation(bus, store, {
        op: 'promoted',
        tempId: String(tempId),
        groupId: String(realId),
      });
      return true;
    },

    /**
     * Clear a group override after it has been persisted.
     * @param {string} groupId
     * @param {string[]|null} [committedTaskIds]  Member deltas that were committed;
     *        pass null to drop the whole override entry.
     */
    clearGroupOverride(groupId, committedTaskIds = null) {
      if (!groupId) return false;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => {
        const key = String(groupId);
        const current = scenario.groupOverrides[key];
        if (current === undefined) return scenario;

        const nextOverrides = { ...scenario.groupOverrides };
        if (committedTaskIds === null) {
          delete nextOverrides[key];
          return { ...scenario, groupOverrides: nextOverrides };
        }

        const committed = new Set(committedTaskIds.map(String));
        const existingDeltas = current.memberDeltas === undefined ? [] : current.memberDeltas;
        const memberDeltas = existingDeltas.filter(
          (entry) => !committed.has(String(entry.taskId))
        );

        const { _deleted, memberDeltas: _dropped, ...fields } = current;
        void _dropped;
        const isEmpty = !_deleted && memberDeltas.length === 0 && Object.keys(fields).length === 0;
        if (isEmpty) {
          delete nextOverrides[key];
        } else {
          nextOverrides[key] = { ...current, memberDeltas };
        }
        return { ...scenario, groupOverrides: nextOverrides };
      }, { allowBaseline: false });

      if (!mutation) return false;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: mutation.items,
          },
        }),
        false,
        'group.clearGroupOverride'
      );

      emitGroupMutation(bus, store, { op: 'clearedOverride', groupId: String(groupId) });
      return true;
    },
  };

  return commands;
}