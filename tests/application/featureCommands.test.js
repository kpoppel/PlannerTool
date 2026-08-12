import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyFeatureCommands,
  createFeatureCommands,
} from '../../www/js/application/commands/featureCommands.js';
import { store } from '../../www/js/application/store.js';
import { CapacityEvents, FeatureEvents, ScenarioEvents } from '../../www/js/core/EventRegistry.js';

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
      items: [
        {
          id: 's1',
          name: 'Scenario 1',
          overrides: {
            f1: { state: 'Done' },
            f2: { start: '2026-01-15', end: '2026-01-25' },
          },
          isChanged: false,
        },
      ],
    },
    ...partial,
  };
}

describe('application/commands/featureCommands', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(buildState(), true, 'test.resetStore');
  });

  it('legacy adapter delegates feature methods 1:1', () => {
    const state = {
      updateFeatureDates: vi.fn(),
      updateFeatureField: vi.fn(),
      setScenarioOverride: vi.fn(),
      revertFeature: vi.fn(),
    };

    const commands = createLegacyFeatureCommands(state);
    commands.updateFeatureDates([{ id: 'f1', start: 'x', end: 'y' }]);
    commands.updateFeatureField('f1', 'state', 'Done');
    commands.setScenarioOverride('f1', 'a', 'b');
    commands.revertFeature('f1');

    expect(state.updateFeatureDates).toHaveBeenCalledWith([{ id: 'f1', start: 'x', end: 'y' }]);
    expect(state.updateFeatureField).toHaveBeenCalledWith('f1', 'state', 'Done');
    expect(state.setScenarioOverride).toHaveBeenCalledWith('f1', 'a', 'b');
    expect(state.revertFeature).toHaveBeenCalledWith('f1');
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
    expect(recomputeCapacity).toHaveBeenCalledWith(['f2']);
    expect(bus.emit).toHaveBeenCalledWith(
      ScenarioEvents.UPDATED,
      expect.objectContaining({ scenarioId: 's1' })
    );
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
    const commands = createFeatureCommands(store, { emit: vi.fn() }, { recomputeCapacityMetrics: vi.fn() });

    commands.updateFeatureDates([{ id: 'f2', start: '2026-02-01' }]);

    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f2.start).toBe('2026-02-01');
    expect(scenario.overrides.f2.end).toBe('2026-01-25');
  });

  it('date updates enforce epic and child clamping semantics', () => {
    const commands = createFeatureCommands(store, { emit: vi.fn() }, { recomputeCapacityMetrics: vi.fn() });

    commands.updateFeatureDates([{ id: 'f0', start: '2026-01-02', end: '2026-01-05' }]);

    let scenario = store.getState().scenarios.items[0];
    // Epic end cannot shrink earlier than child effective end (f2 override end = 2026-01-25)
    expect(scenario.overrides.f0.end).toBe('2026-01-25');

    commands.updateFeatureDates([{ id: 'f1', start: '2025-12-30', end: '2026-01-19' }]);
    scenario = store.getState().scenarios.items[0];
    // Parent epic extends to include moved child start
    expect(scenario.overrides.f0.start).toBe('2025-12-30');
  });

  it('epic move does not shift child dates when child has non-date override only', () => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(
      buildState({
        scenarios: {
          activeId: 's1',
          items: [
            {
              id: 's1',
              name: 'Scenario 1',
              overrides: {
                f2: {
                  capacity: [{ team: 't1', pct: 50 }],
                },
              },
              isChanged: false,
            },
          ],
        },
      }),
      true,
      'test.resetStore.nonDateChildOverride'
    );

    const commands = createFeatureCommands(store, { emit: vi.fn() }, { recomputeCapacityMetrics: vi.fn() });

    commands.updateFeatureDates([{ id: 'f0', start: '2026-01-04', end: '2026-02-02' }]);

    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f2.capacity).toEqual([{ team: 't1', pct: 50 }]);
    expect(scenario.overrides.f2.start).toBeUndefined();
    expect(scenario.overrides.f2.end).toBeUndefined();
  });

  it('revertFeature removes override and reports success', () => {
    const commands = createFeatureCommands(store, { emit: vi.fn() });

    const first = commands.revertFeature('f1');
    const second = commands.revertFeature('f1');

    expect(first).toBe(true);
    expect(second).toBe(false);
    const scenario = store.getState().scenarios.items[0];
    expect(scenario.overrides.f1).toBeUndefined();
  });

  it('store-mode feature updates ignore legacy compatibility adapters', () => {
    const bus = { emit: vi.fn() };
    const legacyState = new Proxy(
      {},
      {
        get(_target, prop) {
          throw new Error(`legacy state should not be accessed in store mode: ${String(prop)}`);
        },
      }
    );

    const commands = createFeatureCommands(store, bus, legacyState);
    const updated = commands.updateFeatureField('f2', 'state', 'Blocked');

    expect(updated).toEqual({ id: 'f2', state: 'Blocked' });
    expect(store.getState().scenarios.items[0].overrides.f2.state).toBe('Blocked');
  });
});
