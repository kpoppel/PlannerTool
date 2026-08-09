import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyGroupCommands,
  createGroupCommands,
} from '../../www/js/application/commands/groupCommands.js';
import { store } from '../../www/js/application/store.js';
import { GroupEvents } from '../../www/js/core/EventRegistry.js';

function seedStore() {
  return {
    ...createInitialAppState(),
    scenarios: {
      activeId: 's1',
      items: [
        {
          id: 's1',
          name: 'Scenario',
          readonly: false,
          isChanged: false,
          scenarioGroups: [],
          groupOverrides: {},
        },
      ],
    },
    groups: {
      byPlanId: {
        p1: [{ id: 'g1', plan_id: 'p1', name: 'A', members: ['f1'] }],
      },
    },
  };
}

describe('application/commands/groupCommands', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(seedStore(), true, 'test.resetStore');
  });

  it('legacy adapter delegates to state + groupService', () => {
    const state = {
      createGroupInScenario: vi.fn(),
      updateGroupInScenario: vi.fn(),
      deleteGroupInScenario: vi.fn(),
      applyGroupMemberDelta: vi.fn(),
      clearPendingGroupChanges: vi.fn(),
      confirmGroupCreate: vi.fn(),
      getActiveScenario: vi.fn(() => ({ scenarioGroups: [] })),
      _markActiveScenarioChanged: vi.fn(),
    };
    const groupService = {
      getGroupsForPlan: vi.fn(() => []),
    };
    const commands = createLegacyGroupCommands(state, groupService);

    commands.createGroupInScenario('p1', 'N', '#fff', null);
    commands.updateGroupInScenario('g1', { name: 'Renamed' });
    commands.deleteGroupInScenario('g1');
    commands.applyGroupMemberDelta('g1', 'f2', 'add');
    commands.addMemberToGroup('g1', 'f3');
    commands.removeMemberFromGroup('g1', 'f1');
    commands.clearPendingGroupChanges();
    commands.confirmGroupCreate('tmp_1', 'g9');

    expect(state.createGroupInScenario).toHaveBeenCalledWith('p1', 'N', '#fff', null);
    expect(state.updateGroupInScenario).toHaveBeenCalledWith('g1', { name: 'Renamed' });
    expect(state.deleteGroupInScenario).toHaveBeenCalledWith('g1');
    expect(state.applyGroupMemberDelta).toHaveBeenCalledWith('g1', 'f2', 'add');
    expect(state.applyGroupMemberDelta).toHaveBeenCalledWith('g1', 'f3', 'add');
    expect(state.applyGroupMemberDelta).toHaveBeenCalledWith('g1', 'f1', 'remove');
    expect(state.clearPendingGroupChanges).toHaveBeenCalledOnce();
    expect(state.confirmGroupCreate).toHaveBeenCalledWith('tmp_1', 'g9');
  });

  it('store createGroupInScenario appends scenario group and emits changed', () => {
    const bus = { emit: vi.fn() };
    const commands = createGroupCommands(store, bus);

    const created = commands.createGroupInScenario('p1', 'New Group', '#123', null);

    expect(created).toBeTruthy();
    expect(created.plan_id).toBe('p1');
    expect(store.getState().scenarios.items[0].scenarioGroups).toHaveLength(1);
    expect(bus.emit).toHaveBeenCalledWith(
      GroupEvents.CHANGED,
      expect.objectContaining({ op: 'created' })
    );
  });

  it('store add/remove member updates baseline group deltas', () => {
    const bus = { emit: vi.fn() };
    const commands = createGroupCommands(store, bus);

    expect(commands.addMemberToGroup('g1', 'f2')).toBe(true);
    expect(commands.removeMemberFromGroup('g1', 'f1')).toBe(true);

    const overrides = store.getState().scenarios.items[0].groupOverrides;
    expect(overrides.g1.memberDeltas).toEqual([
      { taskId: 'f2', op: 'add' },
      { taskId: 'f1', op: 'remove' },
    ]);
  });
});