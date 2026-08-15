import { GroupEvents, ScenarioEvents } from '../../core/EventRegistry.js';

function getScenarioItems(state) {
  return Array.isArray(state?.scenarios?.items) ? state.scenarios.items : [];
}

function getActiveScenarioId(state) {
  return state?.scenarios?.activeId ?? 'baseline';
}

function isMutableScenario(scenario) {
  return Boolean(scenario) && scenario.readonly !== true;
}

function withActiveScenario(state, updater) {
  const activeId = getActiveScenarioId(state);
  if (!activeId || activeId === 'baseline') return null;

  let changed = false;
  const nextItems = getScenarioItems(state).map((scenario) => {
    if (scenario.id !== activeId) return scenario;
    if (!isMutableScenario(scenario)) return scenario;
    const nextScenario = updater(scenario);
    if (!nextScenario || nextScenario === scenario) return scenario;
    changed = true;
    return nextScenario;
  });

  if (!changed) return null;
  return {
    activeId,
    items: nextItems,
  };
}

function applyGroupMemberDeltaToScenario(scenario, groupId, taskId, op) {
  const key = String(groupId);
  const nextOverrides = { ...(scenario.groupOverrides || {}) };
  const current = nextOverrides[key] || {};
  const nextDeltas = (current.memberDeltas || []).filter(
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

function emitGroupMutation(bus, store, payload) {
  void store;
  void payload;
  bus?.emit?.(GroupEvents.CHANGED);
  bus?.emit?.(ScenarioEvents.UPDATED);
}

function buildTempGroupId() {
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createGroupCommands(store, bus) {
  return {
    createGroupInScenario(planId, name, color = null, parentId = null) {
      const safeName = String(name || '').trim();
      if (!planId || !safeName) return null;

      const tempGroup = {
        id: buildTempGroupId(),
        plan_id: String(planId),
        name: safeName,
        rank: Date.now(),
        members: [],
        color: color || null,
        parent_id: parentId || null,
      };

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => ({
        ...scenario,
        scenarioGroups: [...(scenario.scenarioGroups || []), tempGroup],
      }));

      if (!mutation) return null;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
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
      const mutation = withActiveScenario(snapshot, (scenario) => {
        const scenarioGroups = Array.isArray(scenario.scenarioGroups) ? scenario.scenarioGroups : [];
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

        const nextOverrides = { ...(scenario.groupOverrides || {}) };
        nextOverrides[String(groupId)] = {
          ...(nextOverrides[String(groupId)] || {}),
          ...fields,
        };

        return {
          ...scenario,
          groupOverrides: nextOverrides,
        };
      });

      if (!mutation) return null;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: mutation.items,
          },
        }),
        false,
        'group.updateGroupInScenario'
      );

      emitGroupMutation(bus, store, { op: 'updated', groupId: String(groupId) });
      return true;
    },

    deleteGroupInScenario(groupId) {
      if (!groupId) return false;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => {
        const scenarioGroups = Array.isArray(scenario.scenarioGroups) ? scenario.scenarioGroups : [];
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

        const nextOverrides = { ...(scenario.groupOverrides || {}) };
        nextOverrides[String(groupId)] = {
          ...(nextOverrides[String(groupId)] || {}),
          _deleted: true,
        };

        return {
          ...scenario,
          groupOverrides: nextOverrides,
        };
      });

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
        'group.deleteGroupInScenario'
      );

      emitGroupMutation(bus, store, { op: 'deleted', groupId: String(groupId) });
      return true;
    },

    applyGroupMemberDelta(groupId, taskId, op) {
      if (!groupId || !taskId || (op !== 'add' && op !== 'remove')) return false;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) =>
        applyGroupMemberDeltaToScenario(scenario, groupId, taskId, op)
      );

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
      if (!groupId || !taskId) return false;

      const snapshot = store.getState();
      const scenario = getScenarioItems(snapshot).find((item) => item.id === getActiveScenarioId(snapshot));
      if (!isMutableScenario(scenario)) return false;

      const localGroup = (scenario.scenarioGroups || []).find(
        (group) => String(group.id) === String(groupId)
      );

      if (localGroup) {
        const hasMember = (localGroup.members || []).some(
          (memberId) => String(memberId) === String(taskId)
        );
        if (hasMember) return true;

        return Boolean(
          this.updateGroupInScenario(groupId, {
            members: [...(localGroup.members || []), String(taskId)],
          })
        );
      }

      return this.applyGroupMemberDelta(groupId, taskId, 'add');
    },

    removeMemberFromGroup(groupId, taskId) {
      if (!groupId || !taskId) return false;

      const snapshot = store.getState();
      const scenario = getScenarioItems(snapshot).find((item) => item.id === getActiveScenarioId(snapshot));
      if (!isMutableScenario(scenario)) return false;

      const localGroup = (scenario.scenarioGroups || []).find(
        (group) => String(group.id) === String(groupId)
      );

      if (localGroup) {
        const nextMembers = (localGroup.members || []).filter(
          (memberId) => String(memberId) !== String(taskId)
        );
        return Boolean(this.updateGroupInScenario(groupId, { members: nextMembers }));
      }

      return this.applyGroupMemberDelta(groupId, taskId, 'remove');
    },

    clearPendingGroupChanges() {
      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => ({
        ...scenario,
        scenarioGroups: [],
        groupOverrides: {},
      }));

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

    confirmGroupCreate(tempId, realId) {
      if (!tempId || !realId) return false;

      const snapshot = store.getState();
      const mutation = withActiveScenario(snapshot, (scenario) => ({
        ...scenario,
        scenarioGroups: (scenario.scenarioGroups || []).map((group) =>
          String(group.id) === String(tempId) ? { ...group, id: String(realId) } : group
        ),
      }));

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
        'group.confirmGroupCreate'
      );

      emitGroupMutation(bus, store, {
        op: 'confirmedCreate',
        tempId: String(tempId),
        groupId: String(realId),
      });
      return true;
    },
  };
}