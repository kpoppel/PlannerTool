import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createGroupCommands } from '../../www/js/application/commands/groupCommands.js';
import { createGroupSelectors } from '../../www/js/application/selectors/groupSelectors.js';
import { store } from '../../www/js/application/store.js';

const bus = { emit: vi.fn() };

function seedStore(scenarioGroups, groupOverrides, baselineGroups = []) {
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
          scenarioGroups,
          groupOverrides,
        },
      ],
    },
    groups: { byPlanId: { p1: baselineGroups } },
  };
}

const tempGroup = (id, members = []) => ({
  id,
  plan_id: 'p1',
  name: 'Pending',
  rank: 1024,
  members,
  color: null,
  parent_id: null,
});

describe('groupCommands — publishing to baseline', () => {
  let commands;
  let selectors;

  beforeEach(() => {
    bus.emit.mockClear();
    commands = createGroupCommands(store, bus);
    selectors = createGroupSelectors(store);
  });

  it('removes a published group from scenarioGroups so it is not created twice', () => {
    store.setState(seedStore([tempGroup('tmp_1')], {}), true, 'test.reset');

    expect(commands.promoteGroupToBaseline('tmp_1', 'real-1')).toBe(true);

    expect(store.getState().scenarios.items[0].scenarioGroups).toEqual([]);
  });

  it('keeps members that were not committed as pending deltas on the real group', () => {
    store.setState(seedStore([tempGroup('tmp_1', ['t1', 't2'])], {}), true, 'test.reset');

    commands.promoteGroupToBaseline('tmp_1', 'real-1', ['t2']);

    const overrides = store.getState().scenarios.items[0].groupOverrides;
    expect(overrides['real-1'].memberDeltas).toEqual([{ taskId: 't2', op: 'add' }]);
  });

  it('leaves no override behind when every member was committed', () => {
    store.setState(seedStore([tempGroup('tmp_1', ['t1'])], {}), true, 'test.reset');

    commands.promoteGroupToBaseline('tmp_1', 'real-1', []);

    expect(store.getState().scenarios.items[0].groupOverrides).toEqual({});
  });

  it('does not resurrect the published group on a later read', () => {
    store.setState(
      seedStore([tempGroup('tmp_1')], {}, [
        { id: 'real-1', plan_id: 'p1', name: 'Pending', rank: 1024, parent_id: null, members: [] },
      ]),
      true,
      'test.reset'
    );

    commands.promoteGroupToBaseline('tmp_1', 'real-1');

    expect(selectors.getEffectiveGroups('p1').map((g) => g.id)).toEqual(['real-1']);
  });

  it('drops committed member deltas and removes an emptied override', () => {
    store.setState(
      seedStore([], {
        g1: { memberDeltas: [{ taskId: 't1', op: 'add' }, { taskId: 't2', op: 'add' }] },
      }),
      true,
      'test.reset'
    );

    commands.clearGroupOverride('g1', ['t1']);
    expect(store.getState().scenarios.items[0].groupOverrides.g1.memberDeltas).toEqual([
      { taskId: 't2', op: 'add' },
    ]);

    commands.clearGroupOverride('g1', ['t2']);
    expect(store.getState().scenarios.items[0].groupOverrides).toEqual({});
  });

  it('keeps field edits when only member deltas were committed', () => {
    store.setState(
      seedStore([], { g1: { name: 'Renamed', memberDeltas: [{ taskId: 't1', op: 'add' }] } }),
      true,
      'test.reset'
    );

    commands.clearGroupOverride('g1', ['t1']);

    expect(store.getState().scenarios.items[0].groupOverrides.g1).toEqual({
      name: 'Renamed',
      memberDeltas: [],
    });
  });

  it('drops the whole override when no committed task list is given', () => {
    store.setState(
      seedStore([], { g1: { _deleted: true }, g2: { name: 'Keep' } }),
      true,
      'test.reset'
    );

    commands.clearGroupOverride('g1');

    expect(store.getState().scenarios.items[0].groupOverrides).toEqual({ g2: { name: 'Keep' } });
  });
});
