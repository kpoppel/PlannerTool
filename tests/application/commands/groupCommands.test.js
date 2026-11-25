import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../../www/js/application/createInitialAppState.js';
import { createGroupCommands } from '../../../www/js/application/commands/groupCommands.js';
import { store } from '../../../www/js/application/store.js';
import { GroupEvents } from '../../../www/js/core/EventRegistry.js';

function seedStore() {
  return {
    ...createInitialAppState(),
    scenarios: {
      activeId: 's1',
      changedIds: [],
      items: [
        {
          id: 's1',
          name: 'Scenario',
          readonly: false,
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
    store.setState(seedStore(), true, 'test.resetStore');
  });

  it('store createGroupInScenario appends scenario group and emits changed', () => {
    const bus = { emit: vi.fn() };
    const commands = createGroupCommands(store, bus);

    const created = commands.createGroupInScenario('p1', 'New Group', '#123', null, 1024);

    expect(created).toBeTruthy();
    expect(created.plan_id).toBe('p1');
    expect(store.getState().scenarios.items[0].scenarioGroups).toHaveLength(1);
    expect(bus.emit).toHaveBeenCalledWith(GroupEvents.CHANGED);
    expect(store.getState().scenarios.changedIds).toContain('s1');
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
    expect(store.getState().scenarios.changedIds).toContain('s1');
  });

  it('moves a subtree with one store write and one group invalidation', () => {
    const bus = { emit: vi.fn() };
    const commands = createGroupCommands(store, bus);
    const target = commands.createGroupInScenario('p1', 'Target', '#123', null, 1024);
    const write = vi.spyOn(store, 'setState');
    bus.emit.mockClear();
    const taskIds = ['f1', ...Array.from({ length: 20 }, (_, index) => `child-${index}`)];

    try {
      expect(commands.updateGroupMemberships([
        { groupId: 'g1', taskId: 'f1', op: 'remove' },
        ...taskIds.map((taskId) => ({ groupId: target.id, taskId, op: 'add' })),
      ])).toBe(true);
      expect(write).toHaveBeenCalledOnce();
      expect(bus.emit.mock.calls.filter(([event]) => event === GroupEvents.CHANGED)).toHaveLength(1);
      const scenario = store.getState().scenarios.items[0];
      expect(scenario.scenarioGroups[0].members).toEqual(taskIds);
      expect(scenario.groupOverrides.g1.memberDeltas).toEqual([{ taskId: 'f1', op: 'remove' }]);
    } finally {
      write.mockRestore();
    }
  });

  it('does not expose legacy compatibility adapters', async () => {
    const mod = await import('../../../www/js/application/commands/groupCommands.js');
    expect(mod.createLegacyGroupCommands).toBeUndefined();
  });
});