import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createGroupCommands } from '../../www/js/application/commands/groupCommands.js';
import { createGroupSelectors } from '../../www/js/application/selectors/groupSelectors.js';
import { store } from '../../www/js/application/store.js';
import { RANK_GAP } from '../../www/js/application/shared/ordering.js';

const bus = { emit: vi.fn() };

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

const baseline = (id, rank, parentId = null) => ({
  id,
  plan_id: 'p1',
  name: id.toUpperCase(),
  rank,
  parent_id: parentId,
  members: [],
});

/** Root-level group names for plan p1, in rank order. */
function rootOrder(selectors) {
  return selectors
    .getEffectiveGroups('p1')
    .filter((group) => !group.parent_id)
    .sort((a, b) => a.rank - b.rank)
    .map((group) => group.name);
}

describe('groupCommands — rank-aware creation', () => {
  let commands;
  let selectors;

  beforeEach(() => {
    bus.emit.mockClear();
    commands = createGroupCommands(store, bus);
    selectors = createGroupSelectors(store);
  });

  it('stores the rank the board slot resolved', () => {
    store.setState(seedStore([]), true, 'test.reset');
    const created = commands.createGroupInScenario('p1', 'First', null, null, 1536);
    expect(created.rank).toBe(1536);
    expect(created.parent_id).toBeNull();
  });

  it('places the new group between the groups surrounding the slot', () => {
    store.setState(
      seedStore([baseline('g1', 1024), baseline('g2', 2048), baseline('g3', 3072)]),
      true,
      'test.reset'
    );

    commands.createGroupInScenario('p1', 'Middle', null, null, 1536);

    expect(rootOrder(selectors)).toEqual(['G1', 'Middle', 'G2', 'G3']);
  });

  it('nests under the parent the slot resolved', () => {
    store.setState(seedStore([baseline('g1', 1024)]), true, 'test.reset');

    const created = commands.createGroupInScenario('p1', 'Child', null, 'g1', RANK_GAP);

    expect(created.parent_id).toBe('g1');
    expect(created.rank).toBe(RANK_GAP);
  });

  it('persists sibling ranks respaced by the slot', () => {
    store.setState(seedStore([baseline('g1', 0), baseline('g2', 0)]), true, 'test.reset');

    commands.createGroupInScenario('p1', 'Middle', null, null, 1536, [
      { id: 'g1', rank: RANK_GAP },
      { id: 'g2', rank: 2 * RANK_GAP },
    ]);

    const overrides = store.getState().scenarios.items[0].groupOverrides;
    expect(overrides.g1.rank).toBe(RANK_GAP);
    expect(overrides.g2.rank).toBe(2 * RANK_GAP);
    expect(rootOrder(selectors)).toEqual(['G1', 'Middle', 'G2']);
  });

  it('respaces scenario-local groups as well as baseline groups', () => {
    store.setState(seedStore([]), true, 'test.reset');
    const local = commands.createGroupInScenario('p1', 'A', null, null, RANK_GAP);

    commands.createGroupInScenario('p1', 'B', null, null, 512, [
      { id: local.id, rank: 2 * RANK_GAP },
    ]);

    expect(rootOrder(selectors)).toEqual(['B', 'A']);
  });

  it('throws when no integer rank is supplied', () => {
    store.setState(seedStore([]), true, 'test.reset');
    expect(() => commands.createGroupInScenario('p1', 'Nope', null, null, undefined)).toThrow(
      /rank/i
    );
  });

  it('returns null and leaves the store untouched in the baseline scenario', () => {
    const seeded = seedStore([baseline('g1', 1024)]);
    seeded.scenarios.activeId = 'baseline';
    seeded.scenarios.items = [
      { id: 'baseline', name: 'Baseline', readonly: true, scenarioGroups: [], groupOverrides: {} },
    ];
    store.setState(seeded, true, 'test.reset');

    expect(commands.createGroupInScenario('p1', 'Nope', null, null, RANK_GAP)).toBeNull();
    expect(store.getState().scenarios.items[0].scenarioGroups).toEqual([]);
  });
});
