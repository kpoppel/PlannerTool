import { GroupEvents } from '../core/EventRegistry.js';

/**
 * Owns scenario-local group changes.
 *
 * Baseline group caching and persistence stay in GroupService. This service
 * owns the overlay stored on a writable scenario: local groups, baseline group
 * overrides, and member deltas.
 */
export class ScenarioGroupService {
  constructor({ bus, getActiveScenario, getActiveWritableScenario, markChanged, now = Date.now, random = Math.random }) {
    this._bus = bus;
    this._getActiveScenario = getActiveScenario;
    this._getActiveWritableScenario = getActiveWritableScenario;
    this._markChanged = markChanged;
    this._now = now;
    this._random = random;
  }

  getPendingChanges() {
    const scenario = this._getActiveScenario();
    const operations = [];

    for (const group of scenario?.scenarioGroups || []) {
      operations.push({ type: 'create', group });
    }

    for (const [groupId, override] of Object.entries(scenario?.groupOverrides || {})) {
      if (override._deleted) {
        operations.push({ type: 'delete', groupId });
        continue;
      }

      const { _deleted, memberDeltas, ...fields } = override;
      const hasFields = Object.keys(fields).length > 0;
      const hasDeltas = memberDeltas?.length > 0;
      if (hasFields || hasDeltas) {
        operations.push({
          type: 'update',
          groupId,
          ...(hasFields && { fields }),
          ...(hasDeltas && { memberDeltas }),
        });
      }
    }

    return operations;
  }

  clearPendingChanges(scenario = this._getActiveWritableScenario()) {
    if (!scenario) return;
    scenario.scenarioGroups = [];
    scenario.groupOverrides = {};
  }

  confirmCreate(tempId, realId, scenario = this._getActiveScenario()) {
    const group = scenario?.scenarioGroups?.find((item) => item.id === tempId);
    if (group) group.id = realId;
  }

  create(planId, name, color = null, parentId = null, scenario = this._getActiveWritableScenario()) {
    if (!scenario) return null;

    const now = this._now();
    const group = {
      id: `tmp_${now}_${this._random().toString(36).slice(2, 8)}`,
      plan_id: String(planId),
      name,
      rank: now,
      members: [],
      color: color || null,
      parent_id: parentId || null,
    };

    if (!scenario.scenarioGroups) scenario.scenarioGroups = [];
    scenario.scenarioGroups.push(group);
    this._changed(scenario);
    this._emit({ op: 'created', group });
    return group;
  }

  update(groupId, fields, scenario = this._getActiveWritableScenario()) {
    if (!scenario) return null;

    const localIndex = (scenario.scenarioGroups || []).findIndex(
      (group) => String(group.id) === String(groupId)
    );
    if (localIndex !== -1) {
      scenario.scenarioGroups[localIndex] = {
        ...scenario.scenarioGroups[localIndex],
        ...fields,
      };
      const group = scenario.scenarioGroups[localIndex];
      this._changed(scenario);
      this._emit({ op: 'updated', group });
      return group;
    }

    if (!scenario.groupOverrides) scenario.groupOverrides = {};
    const override = {
      ...(scenario.groupOverrides[String(groupId)] || {}),
      ...fields,
    };
    scenario.groupOverrides[String(groupId)] = override;
    this._changed(scenario);
    this._emit({ op: 'updated', groupId, fields });
    return override;
  }

  delete(groupId, scenario = this._getActiveWritableScenario()) {
    if (!scenario) return;

    const localGroups = scenario.scenarioGroups || [];
    const removedIds = this._collectDescendantIds(localGroups, groupId);
    const hasLocalGroup = localGroups.some((group) => removedIds.has(String(group.id)));
    if (hasLocalGroup) {
      scenario.scenarioGroups = localGroups.filter((group) => !removedIds.has(String(group.id)));
      this._changed(scenario);
      this._emit({ op: 'deleted', groupId });
      return;
    }

    if (!scenario.groupOverrides) scenario.groupOverrides = {};
    scenario.groupOverrides[String(groupId)] = {
      ...(scenario.groupOverrides[String(groupId)] || {}),
      _deleted: true,
    };
    this._changed(scenario);
    this._emit({ op: 'deleted', groupId });
  }

  applyMemberDelta(groupId, taskId, op, scenario = this._getActiveWritableScenario()) {
    if (!scenario) return;
    if (!scenario.groupOverrides) scenario.groupOverrides = {};

    const override = scenario.groupOverrides[String(groupId)] || {};
    const memberDeltas = (override.memberDeltas || []).filter(
      (delta) => String(delta.taskId) !== String(taskId)
    );
    memberDeltas.push({ taskId: String(taskId), op });
    scenario.groupOverrides[String(groupId)] = { ...override, memberDeltas };
    this._changed(scenario);
    this._emit({ op: 'memberDelta', groupId, taskId, delta: op });
  }

  _collectDescendantIds(groups, groupId) {
    const ids = new Set([String(groupId)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of groups) {
        if (group.parent_id && ids.has(String(group.parent_id)) && !ids.has(String(group.id))) {
          ids.add(String(group.id));
          changed = true;
        }
      }
    }
    return ids;
  }

  _changed(scenario) {
    this._markChanged(scenario);
  }

  _emit(payload) {
    this._bus.emit(GroupEvents.CHANGED, payload);
  }
}
