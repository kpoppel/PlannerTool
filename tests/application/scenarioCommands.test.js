import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyScenarioCommands,
  createScenarioCommands,
} from '../../www/js/application/commands/scenarioCommands.js';
import { store } from '../../www/js/application/store.js';
import { CapacityEvents, ScenarioEvents } from '../../www/js/core/EventRegistry.js';
import { dataService } from '../../www/js/services/dataService.js';

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
    const commands = createScenarioCommands(store, bus);

    const result = commands.activateScenario('s2');

    expect(result?.id).toBe('s2');
    expect(store.getState().scenarios.activeId).toBe('s2');
    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.ACTIVATED, { scenarioId: 's2' });
    expect(bus.emit).toHaveBeenCalledWith(
      CapacityEvents.UPDATED,
      expect.objectContaining({
        totalOrgDailyCapacity: expect.any(Array),
      })
    );
  });

  it('store-mode activation does not touch legacy state adapters', () => {
    const bus = { emit: vi.fn() };
    const legacyState = new Proxy(
      {},
      {
        get(_target, prop) {
          throw new Error(`legacy state should not be accessed in store mode: ${String(prop)}`);
        },
      }
    );

    const commands = createScenarioCommands(store, bus, legacyState);

    expect(() => commands.activateScenario('s2')).not.toThrow();
    expect(store.getState().scenarios.activeId).toBe('s2');
  });

  it('saveScenario persists the active scenario without legacy state access', async () => {
    const bus = { emit: vi.fn() };
    const saved = { ok: true, data: { id: 's1' } };
    const saveSpy = vi.spyOn(dataService, 'saveScenario').mockResolvedValue(saved);
    const commands = createScenarioCommands(store, bus);

    const result = await commands.saveScenario('s1');

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 's1',
        name: 'Alpha',
        overrides: { f1: { start: '2026-01-01' } },
      })
    );
    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 's1')?.isChanged).toBe(
      false
    );
    expect(result).toBe(saved);
    saveSpy.mockRestore();
  });

  it('refreshBaseline delegates to the store data hydration path', async () => {
    const bus = { emit: vi.fn() };
    const hydrateBaseline = vi.fn().mockResolvedValue({ ok: true, data: { revision: 1 } });
    const commands = createScenarioCommands(store, bus, null, { hydrateBaseline });

    const result = await commands.refreshBaseline();

    expect(hydrateBaseline).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, data: { revision: 1 } });
  });

  it('invalidateAndRefreshBaseline invalidates cache before hydration', async () => {
    const bus = { emit: vi.fn() };
    const invalidateCache = vi.spyOn(dataService, 'invalidateCache').mockResolvedValue({ ok: true });
    const hydrateBaseline = vi.fn().mockResolvedValue({ ok: true, data: { revision: 2 } });
    const commands = createScenarioCommands(store, bus, null, { hydrateBaseline });

    const result = await commands.invalidateAndRefreshBaseline();

    expect(invalidateCache).toHaveBeenCalledTimes(1);
    expect(hydrateBaseline).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, data: { revision: 2 } });
    invalidateCache.mockRestore();
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
