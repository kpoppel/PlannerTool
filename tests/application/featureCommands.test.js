import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createFeatureCommands } from '../../www/js/application/commands/featureCommands.js';
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
    const mod = await import('../../www/js/application/commands/featureCommands.js');
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
