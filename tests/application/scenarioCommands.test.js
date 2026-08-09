import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyScenarioCommands,
  createScenarioCommands,
} from '../../www/js/application/commands/scenarioCommands.js';
import { store } from '../../www/js/application/store.js';
import { CapacityEvents, ScenarioEvents } from '../../www/js/core/EventRegistry.js';

function withScenarioState(partial = {}) {
  return {
    ...createInitialAppState(),
    scenarios: {
      activeId: 's1',
      items: [
        {
          id: 's1',
          name: 'Alpha',
          overrides: { f1: { start: '2026-01-01' } },
          filters: { states: ['Doing'] },
          view: { timelineScale: 'months' },
          isChanged: false,
        },
        {
          id: 's2',
          name: 'Beta',
          overrides: {},
          filters: {},
          view: {},
          isChanged: false,
        },
      ],
      ...partial,
    },
  };
}

describe('application/commands/scenarioCommands', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(withScenarioState(), true, 'test.resetStore');
  });

  it('legacy adapter delegates all scenario calls 1:1', () => {
    const state = {
      cloneScenario: vi.fn(),
      activateScenario: vi.fn(),
      renameScenario: vi.fn(),
      deleteScenario: vi.fn(),
      _markActiveScenarioChanged: vi.fn(),
    };
    const commands = createLegacyScenarioCommands(state);

    commands.cloneScenario('s1', 'copy');
    commands.activateScenario('s2');
    commands.renameScenario('s2', 'Renamed');
    commands.deleteScenario('s2');
    commands.markActiveScenarioChanged();

    expect(state.cloneScenario).toHaveBeenCalledWith('s1', 'copy');
    expect(state.activateScenario).toHaveBeenCalledWith('s2');
    expect(state.renameScenario).toHaveBeenCalledWith('s2', 'Renamed');
    expect(state.deleteScenario).toHaveBeenCalledWith('s2');
    expect(state._markActiveScenarioChanged).toHaveBeenCalled();
  });

  it('cloneScenario deep-clones mutable branches and emits updated/list', () => {
    const bus = { emit: vi.fn() };
    const commands = createScenarioCommands(store, bus);

    const created = commands.cloneScenario('s1', 'Alpha');

    expect(created).toBeTruthy();
    expect(created.name).toBe('Alpha 2');
    expect(created.overrides).toEqual({ f1: { start: '2026-01-01' } });

    const scenarios = store.getState().scenarios.items;
    const source = scenarios.find((scenario) => scenario.id === 's1');
    const clone = scenarios.find((scenario) => scenario.id === created.id);

    expect(clone.overrides).not.toBe(source.overrides);
    expect(clone.filters).not.toBe(source.filters);
    expect(clone.view).not.toBe(source.view);

    expect(bus.emit).toHaveBeenCalledWith(
      ScenarioEvents.UPDATED,
      expect.objectContaining({ scenarioId: created.id })
    );
    expect(bus.emit).toHaveBeenCalledWith(
      ScenarioEvents.LIST,
      expect.objectContaining({ activeScenarioId: 's1' })
    );
  });

  it('activateScenario updates active id and emits activation events', () => {
    const bus = { emit: vi.fn() };
    const legacyState = {
      recomputeCapacityMetrics: vi.fn(),
      capacityDates: ['2026-01-01'],
      teamDailyCapacity: [{ id: 't1' }],
      teamDailyCapacityMap: [{ t1: 1 }],
      projectDailyCapacityRaw: [{ id: 'p1' }],
      projectDailyCapacity: [{ id: 'p1', value: 1 }],
      projectDailyCapacityMap: [{ p1: 1 }],
      totalOrgDailyCapacity: [3],
      totalOrgDailyPerTeamAvg: [1.5],
    };
    const commands = createScenarioCommands(store, bus, legacyState);

    const result = commands.activateScenario('s2');

    expect(result?.id).toBe('s2');
    expect(store.getState().scenarios.activeId).toBe('s2');
    expect(legacyState.recomputeCapacityMetrics).toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.ACTIVATED, { scenarioId: 's2' });
    expect(bus.emit).toHaveBeenCalledWith(
      CapacityEvents.UPDATED,
      expect.objectContaining({
        dates: ['2026-01-01'],
        totalOrgDailyCapacity: [3],
      })
    );
  });

  it('activateScenario handles legacy getter-only scenarios property without throwing', () => {
    const bus = { emit: vi.fn() };
    let capturedActiveId = null;
    const legacyState = {
      recomputeCapacityMetrics: vi.fn(),
      _scenarioEventService: {
        getScenarios: () => [{ id: 'baseline', readonly: true }],
        setActiveScenarioId: vi.fn((id) => {
          capturedActiveId = id;
        }),
      },
    };
    Object.defineProperty(legacyState, 'scenarios', {
      get() {
        return [{ id: 'baseline', readonly: true }];
      },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(legacyState, 'activeScenarioId', {
      get() {
        return capturedActiveId;
      },
      set(id) {
        capturedActiveId = id;
      },
      configurable: true,
      enumerable: true,
    });

    const commands = createScenarioCommands(store, bus, legacyState);

    expect(() => commands.activateScenario('s2')).not.toThrow();
    expect(store.getState().scenarios.activeId).toBe('s2');
    expect(capturedActiveId).toBe('s2');
  });

  it('renameScenario enforces unique names and marks changed', () => {
    const bus = { emit: vi.fn() };
    const commands = createScenarioCommands(store, bus);

    const renamed = commands.renameScenario('s2', 'Alpha');

    expect(renamed?.name).toBe('Alpha 2');
    expect(renamed?.isChanged).toBe(true);
    expect(bus.emit).toHaveBeenCalledWith(
      ScenarioEvents.UPDATED,
      expect.objectContaining({
        scenarioId: 's2',
        change: expect.objectContaining({ type: 'rename', name: 'Alpha 2' }),
      })
    );
  });

  it('deleteScenario removes the item and falls back to baseline when active', () => {
    const bus = { emit: vi.fn() };
    const commands = createScenarioCommands(store, bus);

    commands.deleteScenario('s1');

    const ids = store.getState().scenarios.items.map((scenario) => scenario.id);
    expect(ids).toEqual(['s2']);
    expect(store.getState().scenarios.activeId).toBe('baseline');
    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.ACTIVATED, { scenarioId: 'baseline' });
  });

  it('markActiveScenarioChanged toggles isChanged once and reports status', () => {
    const bus = { emit: vi.fn() };
    const commands = createScenarioCommands(store, bus);

    const first = commands.markActiveScenarioChanged();
    const second = commands.markActiveScenarioChanged();

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 's1')?.isChanged).toBe(
      true
    );
  });
});
