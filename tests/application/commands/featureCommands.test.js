import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../../www/js/application/createInitialAppState.js';
import { createFeatureCommands } from '../../../www/js/application/commands/featureCommands.js';
import { store } from '../../../www/js/application/store.js';
import { CapacityEvents, FeatureEvents, ScenarioEvents } from '../../../www/js/core/EventRegistry.js';

function buildState(partial = {}) {
  return {
    ...createInitialAppState(),
    baseline: {
      ...createInitialAppState().baseline,
      features: [
        {
          id: 'f0',
          title: 'Epic',
          type: 'epic',
          start: '2026-01-01',
          end: '2026-02-01',
          state: 'Doing',
        },
        {
          id: 'f1',
          title: 'Alpha',
          type: 'feature',
          parentId: 'f0',
          start: '2026-01-10',
          end: '2026-01-20',
          state: 'Doing',
        },
        {
          id: 'f2',
          title: 'Beta',
          type: 'feature',
          parentId: 'f0',
          start: '2026-01-12',
          end: '2026-01-24',
          state: 'Todo',
        },
      ],
    },
    scenarios: {
      activeId: 's1',
      changedIds: [],
      items: [
        {
          id: 's1',
          name: 'Scenario 1',
          overrides: {
            f1: { state: 'Done' },
            f2: { start: '2026-01-15', end: '2026-01-25' },
          },
        },
      ],
    },
    ...partial,
  };
}

describe('application/commands/featureCommands', () => {
  beforeEach(() => {
    store.setState(buildState(), true, 'test.resetStore');
  });

  it('updateFeatureDates writes overrides for each feature id', () => {
    const bus = { emit: vi.fn() };
    const recomputeCapacity = vi.fn();
    const commands = createFeatureCommands(store, bus, recomputeCapacity);

    commands.updateFeatureDates([
      { id: 'f1', start: '2026-04-01', end: '2026-04-10' },
      { id: 'f2', start: '2026-05-01', end: '2026-05-10' },
    ]);

    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f1.start).toBe('2026-04-01');
    expect(scenario.overrides.f2.end).toBe('2026-05-10');
    expect(recomputeCapacity).toHaveBeenCalledWith(expect.arrayContaining(['f1', 'f2']));
    expect(bus.emit).toHaveBeenCalledWith(
      FeatureEvents.UPDATED,
      expect.objectContaining({ ids: expect.arrayContaining(['f1', 'f2']) })
    );
    expect(recomputeCapacity).toHaveBeenCalledWith(expect.arrayContaining(['f1', 'f2']));
  });

  it('updateFeatureField mutates one field override and returns payload', () => {
    const bus = { emit: vi.fn() };
    const recomputeCapacity = vi.fn();
    const commands = createFeatureCommands(store, bus, recomputeCapacity);

    const updated = commands.updateFeatureField('f2', 'state', 'Blocked');

    expect(updated).toEqual({ id: 'f2', state: 'Blocked' });
    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f2.state).toBe('Blocked');
    expect(store.getState().scenarios.changedIds).toContain('s1');
    expect(recomputeCapacity).toHaveBeenCalledWith(['f2']);
    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.UPDATED);
  });

  function prepareAllocationState() {
    const state = buildState();
    state.baseline.projects = [{ id: 'plan', type: 'Plan', allocatable_ids: ['A', 'G'],
      allocation_defaults: { Plan: ['A', 'G'] } }];
    state.baseline.teams = [
      { id: 'A', kind: 'team', group_id: 'G', archived: false },
      { id: 'G', kind: 'group', archived: false },
    ];
    state.baseline.features = state.baseline.features.map((feature) => ({
      ...feature, project: 'plan', capacity: [],
    }));
    return state;
  }

  function prepareManDayState(capacity = [{ team: 'A', capacity: 20 }]) {
    const state = prepareAllocationState();
    state.baseline.features = [{ ...state.baseline.features[1], parentId: null,
      start: '2026-10-05', end: '2026-10-16', capacity }];
    state.baseline.teams[0].group_id = null;
    state.scenarios.items[0].overrides = {};
    state.allocation = { unit: 'man-days', staffing: {
      status: 'ready', fteById: { A: 5, G: 10 }, generation: 1, error: null,
    } };
    return state;
  }

  it('preserves man-days once per final task schedule and commits dates with integer allocations', () => {
    store.setState(prepareManDayState(), true);
    const notify = vi.fn();
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn(), notify);
    const commits = [];
    const unsubscribe = store.subscribe((state) => commits.push(state));
    commands.updateFeatureDates([
      { id: 'f1', end: '2026-10-23' }, { id: 'f1', end: '2026-10-30' },
    ]);
    unsubscribe();
    expect(commits).toHaveLength(1);
    expect(commits[0].scenarios.items[0].overrides.f1).toEqual({
      start: '2026-10-05', end: '2026-10-30', capacity: [{ team: 'A', capacity: 10 }],
    });
    expect(notify).not.toHaveBeenCalled();
    commands.revertFeature('f1');
    expect(store.getState().scenarios.items[0].overrides.f1).toBeUndefined();
  });

  it('removes unconvertible rows while retaining valid allocations and the requested dates', () => {
    store.setState(prepareManDayState([
      { team: 'A', capacity: 20 }, { team: 'G', capacity: 70 }, { team: 'unknown', capacity: 10 },
    ]), true);
    const notify = vi.fn();
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn(), notify);
    commands.updateFeatureDates([{ id: 'f1', end: '2026-10-09' }]);
    expect(store.getState().scenarios.items[0].overrides.f1).toMatchObject({
      end: '2026-10-09', capacity: [{ team: 'A', capacity: 40 }],
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning',
      message: expect.stringContaining('unknown') }));
    commands.updateFeatureDates([{ id: 'f1', start: null, end: null }]);
    expect(store.getState().scenarios.items[0].overrides.f1.capacity).toEqual([]);
  });

  it('does not persist redundant capacity overrides when scheduling leaves the percentage unchanged', () => {
    store.setState(prepareManDayState(), true);
    const notify = vi.fn();
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn(), notify);
    commands.updateFeatureDates([{ id: 'f1', start: '2026-10-12', end: '2026-10-23' }]);
    expect(store.getState().scenarios.items[0].overrides.f1).toEqual({
      start: '2026-10-12', end: '2026-10-23',
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('explains the child boundary and rejects a fully blocked man-day date edit', () => {
    const state = prepareManDayState([{ team: 'A', capacity: 15 }]);
    state.baseline.features = [
      { ...state.baseline.features[0], id: '795708', start: '2026-06-17', end: '2026-08-04' },
      { ...state.baseline.features[0], id: '750624', parentId: '795708',
        start: '2026-07-21', end: '2026-08-03', capacity: [] },
    ];
    state.allocation.staffing.fteById.A = 6;
    store.setState(state, true);
    const notify = vi.fn();
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn(), notify);
    commands.updateFeatureDates([{ id: '795708', end: '2026-07-24' }]);
    expect(store.getState().scenarios.items[0].overrides['795708']).toEqual({
      start: '2026-06-17', end: '2026-08-03',
      capacity: [{ team: 'A', capacity: 15 * 35 / 34 }],
    });
    expect(store.getState().scenarios.items[0].overrides['750624']).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ code: 'schedule-child-boundary',
      message: expect.stringContaining('750624 (2026-08-03)') }));
    const scenarios = store.getState().scenarios;
    notify.mockClear();
    expect(commands.updateFeatureDates([{ id: '795708', end: '2026-07-24' }])).toEqual([]);
    expect(store.getState().scenarios).toBe(scenarios);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ code: 'schedule-child-boundary' }));
  });

  it('blocks loading/error staffing and protected duplicate removal without any mutation', () => {
    for (const status of ['idle', 'loading', 'error', 'duplicates']) {
      const state = prepareManDayState(status === 'duplicates'
        ? [{ team: 'unknown', capacity: 20 }, { team: 'unknown', capacity: 30 }]
        : [{ team: 'A', capacity: 20 }]);
      if (status !== 'duplicates') state.allocation.staffing.status = status;
      store.setState(state, true);
      const before = store.getState();
      const notify = vi.fn();
      const recompute = vi.fn();
      const commands = createFeatureCommands(store, { emit: vi.fn() }, recompute, notify);
      expect(commands.updateFeatureDates([{ id: 'f1', end: '2026-10-30' }])).toEqual([]);
      expect(store.getState()).toBe(before);
      expect(recompute).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }));
    }
  });

  it('converts propagated parents but leaves unchanged overridden children untouched', () => {
    const state = prepareManDayState();
    state.baseline.features.push({ ...state.baseline.features[0], id: 'child', parentId: 'f1',
      start: '2026-10-05', end: '2026-10-09', capacity: [{ team: 'A', capacity: 10 }] });
    state.scenarios.items[0].overrides.child = { state: 'Done' };
    store.setState(state, true);
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn(), vi.fn());
    commands.updateFeatureDates([{ id: 'f1', start: '2026-10-12', end: '2026-10-30' }]);
    expect(store.getState().scenarios.items[0].overrides.child).toEqual({ state: 'Done' });
    expect(store.getState().scenarios.items[0].overrides.f1.capacity)
      .toEqual([{ team: 'A', capacity: 200 / 15 }]);
    commands.updateFeatureDates([{ id: 'child', end: '2026-11-06' }]);
    expect(store.getState().scenarios.items[0].overrides.f1.end).toBe('2026-11-06');
    expect(store.getState().scenarios.items[0].overrides.f1.capacity)
      .toEqual([{ team: 'A', capacity: 8 }]);
  });

  it('keeps percentage mode independent of staffing and does not change allocations on no-op dates', () => {
    const state = prepareManDayState();
    state.allocation.unit = 'percent';
    state.allocation.staffing.status = 'error';
    store.setState(state, true);
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn(), vi.fn());
    commands.updateFeatureDates([{ id: 'f1', end: '2026-10-30' }]);
    expect(store.getState().scenarios.items[0].overrides.f1.capacity).toBeUndefined();
  });

  it('rejects a capacity choice outside the explicit owner override without side effects', () => {
    const state = prepareAllocationState();
    state.baseline.projects[0].allocatable_ids = [];
    store.setState(state, true, 'test.allocationAvailability');
    const bus = { emit: vi.fn() };
    const recompute = vi.fn();
    const commands = createFeatureCommands(store, bus, recompute);
    const before = store.getState();
    expect(() => commands.updateFeatureField('f1', 'capacity',
      [{ team: 'A', capacity: 40 }])).toThrow('not offered');
    expect(store.getState()).toBe(before);
    expect(bus.emit).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });

  it('rejects descendant group allocation below an ancestor member before committing', () => {
    const state = prepareAllocationState();
    state.baseline.features[0].capacity = [{ team: 'A', capacity: 80 }];
    store.setState(state, true, 'test.allocationConflict');
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn());
    const before = store.getState();
    expect(() => commands.updateFeatureField('f1', 'capacity',
      [{ team: 'G', capacity: 40 }])).toThrow('Allocation conflict');
    expect(store.getState()).toBe(before);
  });

  it('rejects date changes that activate an invalid descendant group reservation', () => {
    for (const edit of ['updateFeatureDates', 'setScenarioOverride', 'updateFeatureField']) {
      const state = prepareAllocationState();
      state.baseline.features[0].capacity = [{ team: 'A', capacity: 80 }];
      state.baseline.features[1] = { ...state.baseline.features[1], start: null, end: '2026-01-20',
        capacity: [{ team: 'G', capacity: 40 }] };
      store.setState(state, true, 'test.dateAllocationConflict');
      const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn());
      const before = store.getState();
      const apply = edit === 'updateFeatureDates'
        ? () => commands.updateFeatureDates([{ id: 'f1', start: '2026-01-10', end: '2026-01-20' }])
        : edit === 'setScenarioOverride'
          ? () => commands.setScenarioOverride('f1', '2026-01-10', '2026-01-20')
          : () => commands.updateFeatureField('f1', 'start', '2026-01-10');
      expect(apply).toThrow('Allocation conflict');
      expect(store.getState()).toBe(before);
    }
  });

  it('fails loudly when the recomputeCapacity seam is missing', () => {
    const commands = createFeatureCommands(store, { emit: vi.fn() }, undefined);
    expect(() => commands.updateFeatureField('f2', 'state', 'Blocked')).toThrow(TypeError);
  });

  it('setScenarioOverride sets start/end override pair', () => {
    const recomputeCapacity = vi.fn();
    const commands = createFeatureCommands(store, { emit: vi.fn() }, recomputeCapacity);

    const result = commands.setScenarioOverride('f2', '2026-06-01', '2026-06-08');

    expect(result).toEqual({ id: 'f2', start: '2026-06-01', end: '2026-06-08' });
    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f2).toEqual(
      expect.objectContaining({ start: '2026-06-01', end: '2026-06-08' })
    );
    expect(recomputeCapacity).toHaveBeenCalledWith(['f2']);
  });

  it('partial date updates preserve omitted values', () => {
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn());

    commands.updateFeatureDates([{ id: 'f2', start: '2026-02-01' }]);

    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f2.start).toBe('2026-02-01');
    expect(scenario.overrides.f2.end).toBe('2026-01-25');
  });

  it('date updates enforce epic and child clamping semantics', () => {
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn());

    commands.updateFeatureDates([{ id: 'f0', start: '2026-01-02', end: '2026-01-05' }]);

    let scenario = store.getState().scenarios.items[0];
    // Epic end cannot shrink earlier than child effective end (f2 override end = 2026-01-25)
    expect(scenario.overrides.f0.end).toBe('2026-01-25');

    commands.updateFeatureDates([{ id: 'f1', start: '2025-12-30', end: '2026-01-19' }]);
    scenario = store.getState().scenarios.items[0];
    // Parent epic extends to include moved child start
    expect(scenario.overrides.f0.start).toBe('2025-12-30');
  });

  it('does not shift children when a parent bounds-only update opts out', () => {
    store.setState(
      buildState({
        scenarios: {
          activeId: 's1',
          changedIds: [],
          items: [{ id: 's1', name: 'Scenario 1', overrides: {} }],
        },
      }),
      true,
      'test.resetStore.boundsOnlyUpdate'
    );
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn());

    commands.updateFeatureDates([{
      id: 'f0', start: '2026-01-05', end: '2026-02-01', shiftChildren: false,
    }]);

    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f0.start).toBe('2026-01-05');
    expect(scenario.overrides.f1).toBeUndefined();
    expect(scenario.overrides.f2).toBeUndefined();
  });

  it('epic move does not shift child dates when child has non-date override only', () => {
    store.setState(
      buildState({
        scenarios: {
          activeId: 's1',
          changedIds: [],
          items: [
            {
              id: 's1',
              name: 'Scenario 1',
              overrides: {
                f2: {
                  capacity: [{ team: 't1', pct: 50 }],
                },
              },
            },
          ],
        },
      }),
      true,
      'test.resetStore.nonDateChildOverride'
    );

    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn());

    commands.updateFeatureDates([{ id: 'f0', start: '2026-01-04', end: '2026-02-02' }]);

    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f2.capacity).toEqual([{ team: 't1', pct: 50 }]);
    expect(scenario.overrides.f2.start).toBeUndefined();
    expect(scenario.overrides.f2.end).toBeUndefined();
  });

  it('revertFeature removes override and reports success', () => {
    const commands = createFeatureCommands(store, { emit: vi.fn() }, vi.fn());

    const first = commands.revertFeature('f1');
    const second = commands.revertFeature('f1');

    expect(first).toBe(true);
    expect(second).toBe(false);
    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f1).toBeUndefined();
  });

  it('does not expose legacy compatibility adapters', async () => {
    const mod = await import('../../../www/js/application/commands/featureCommands.js');
    expect(mod.createLegacyFeatureCommands).toBeUndefined();
  });

  it('setSelectedFeature writes selectedId to featureDisplay and emits bare SELECTED', () => {
    const mockBus = { emit: vi.fn() };
    const commands = createFeatureCommands(store, mockBus);

    commands.setSelectedFeature({ id: 'f1', title: 'Alpha' });

    expect(store.getState().featureDisplay.selectedId).toBe('f1');
    expect(mockBus.emit).toHaveBeenCalledWith(FeatureEvents.SELECTED);
    expect(mockBus.emit).not.toHaveBeenCalledWith(FeatureEvents.SELECTED, expect.anything());
  });

  it('setSelectedFeature with null feature clears selectedId', () => {
    store.setState(
      (s) => ({ ...s, featureDisplay: { selectedId: 'f1' } }),
      false,
      'test.preset'
    );
    const commands = createFeatureCommands(store, { emit: vi.fn() });

    commands.setSelectedFeature(null);

    expect(store.getState().featureDisplay.selectedId).toBeNull();
  });
});
