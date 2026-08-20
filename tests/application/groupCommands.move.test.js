import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createGroupCommands } from '../../www/js/application/commands/groupCommands.js';
import { createGroupSelectors } from '../../www/js/application/selectors/groupSelectors.js';
import { store } from '../../www/js/application/store.js';

const bus = { emit: vi.fn() };

function baseline(id, rank, parentId = null) {
  return {
    id,
    plan_id: 'p1',
    name: id.toUpperCase(),
    rank,
    parent_id: parentId,
    members: [],
  };
}

function seedStore(baselineGroups) {
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
    groups: { byPlanId: { p1: baselineGroups } },
  };
}

function rootIds(selectors) {
  return selectors
    .getEffectiveGroups('p1')
    .filter((group) => !group.parent_id)
    .sort((a, b) => a.rank - b.rank)
    .map((group) => group.id);
}

describe('groupCommands — phase 2 move/nest/outdent', () => {
  let commands;
  let selectors;

  beforeEach(() => {
    bus.emit.mockClear();
    commands = createGroupCommands(store, bus);
    selectors = createGroupSelectors(store);
  });

  it('moves a root group up among siblings', () => {
    store.setState(
      seedStore([baseline('g1', 1024), baseline('g2', 2048), baseline('g3', 3072)]),
      true,
      'test.reset'
    );

    const ok = commands.moveGroupInScenario('g3', { parentId: null, afterGroupId: 'g1' });

    expect(ok).toBe(true);
    expect(rootIds(selectors)).toEqual(['g1', 'g3', 'g2']);
  });

  it('indents a group under its previous sibling', () => {
    store.setState(seedStore([baseline('g1', 1024), baseline('g2', 2048)]), true, 'test.reset');

    const ok = commands.moveGroupInScenario('g2', { parentId: 'g1', afterGroupId: null });

    expect(ok).toBe(true);
    const moved = selectors.getGroupById('g2');
    expect(moved.parent_id).toBe('g1');
  });

  it('outdents a child group to root after its parent', () => {
    store.setState(
      seedStore([
        baseline('g1', 1024),
        baseline('g2', 1024, 'g1'),
        baseline('g3', 2048),
      ]),
      true,
      'test.reset'
    );

    const ok = commands.moveGroupInScenario('g2', { parentId: null, afterGroupId: 'g1' });

    expect(ok).toBe(true);
    const moved = selectors.getGroupById('g2');
    expect(moved.parent_id).toBeNull();
    expect(rootIds(selectors)).toEqual(['g1', 'g2', 'g3']);
  });

  it('rejects moves that create parent/descendant cycles', () => {
    store.setState(
      seedStore([
        baseline('g1', 1024),
        baseline('g2', 1024, 'g1'),
        baseline('g3', 1024, 'g2'),
      ]),
      true,
      'test.reset'
    );

    expect(() =>
      commands.moveGroupInScenario('g1', { parentId: 'g3', afterGroupId: null })
    ).toThrow(/descendant/i);
  });

  it('returns false in the baseline scenario', () => {
    const seeded = seedStore([baseline('g1', 1024), baseline('g2', 2048)]);
    seeded.scenarios.activeId = 'baseline';
    seeded.scenarios.items = [
      {
        id: 'baseline',
        name: 'Baseline',
        readonly: true,
        scenarioGroups: [],
        groupOverrides: {},
      },
    ];
    store.setState(seeded, true, 'test.reset');

    expect(commands.moveGroupInScenario('g2', { parentId: null, afterGroupId: 'g1' })).toBe(false);
  });
});