import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createGroupCommands } from '../../www/js/application/commands/groupCommands.js';
import { store } from '../../www/js/application/store.js';
import { GroupEvents } from '../../www/js/core/EventRegistry.js';

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

    const created = commands.createGroupInScenario('p1', 'New Group', '#123', null);

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

  it('does not expose legacy compatibility adapters', async () => {
    const mod = await import('../../www/js/application/commands/groupCommands.js');
    expect(mod.createLegacyGroupCommands).toBeUndefined();
  });
});