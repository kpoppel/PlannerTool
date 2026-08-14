import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../www/js/application/imports.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createScenarioCommands } from '../../www/js/application/commands/scenarioCommands.js';
import { store } from '../../www/js/application/store.js';
import { bus } from '../../www/js/core/EventBus.js';
import { CapacityEvents, DataEvents, ScenarioEvents } from '../../www/js/core/EventRegistry.js';
import { dataService } from '../../www/js/services/dataService.js';

function withScenarioState(partial = {}) {
  return {
    ...createInitialAppState(),
    scenarios: {
      activeId: 's1',
      changedIds: [],
      items: [
        {
          id: 's1',
          name: 'Alpha',
          overrides: { f1: { start: '2026-01-01' } },
          filters: { states: ['Doing'] },
          view: { timelineScale: 'months' },
        },
        {
          id: 's2',
          name: 'Beta',
          overrides: {},
          filters: {},
          view: {},
        },
      ],
      ...partial,
    },
  };
}

describe('application/commands/scenarioCommands', () => {
  beforeEach(() => {
    store.setState(withScenarioState(), true, 'test.resetStore');
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

    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.UPDATED);
    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.LIST);
  });

  it('activateScenario updates active id and emits activation events', () => {
    const bus = { emit: vi.fn() };
    const recomputeCapacity = vi.fn();
    const commands = createScenarioCommands(store, bus, null, { recomputeCapacity });

    const result = commands.activateScenario('s2');

    expect(result?.id).toBe('s2');
    expect(store.getState().scenarios.activeId).toBe('s2');
    expect(recomputeCapacity).toHaveBeenCalledTimes(1);
    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.ACTIVATED);
    expect(bus.emit).toHaveBeenCalledWith(CapacityEvents.UPDATED);
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
    expect(store.getState().scenarios.changedIds).not.toContain('s1');
    expect(result).toBe(saved);
    saveSpy.mockRestore();
  });

  it('syncs refreshed server metadata without dropping the existing scenario name or app dirty flags', () => {
    store.setState(
      {
        ...createInitialAppState(),
        scenarios: {
          activeId: 's1',
          changedIds: ['s1', 's2'],
          items: [
            { id: 'baseline', name: 'Baseline', overrides: {} },
            {
              id: 's1',
              name: 'Alpha',
              overrides: { f1: { start: '2026-01-01' } },
              filters: { states: ['Doing'] },
              view: { timelineScale: 'months' },
            },
          ],
        },
      },
      true,
      'test.syncServerMeta'
    );

    bus.emit(DataEvents.SCENARIOS_CHANGED, [{ id: 's1', name: 'Alpha' }]);

    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 's1')).toMatchObject({
      id: 's1',
      name: 'Alpha',
    });
    expect(store.getState().scenarios.changedIds).toEqual(['s1', 's2']);
  });

  it('saveScenario clears the saved scenario dirty flag even after a hydrate refresh', async () => {
    const bus = { emit: vi.fn() };
    const saveSpy = vi.spyOn(dataService, 'saveScenario').mockResolvedValue({ ok: true, data: { id: 's1' } });
    const hydrateScenarioData = vi.fn().mockImplementation(async () => {
      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: [
              ...state.scenarios.items,
              { id: 's1', name: 'Alpha', overrides: {}, filters: {}, view: {} },
            ],
          },
        }),
        false,
        'test.hydrateScenarioData'
      );
      return { ok: true };
    });
    const commands = createScenarioCommands(store, bus, null, { hydrateScenarioData });

    store.setState(
      {
        ...createInitialAppState(),
        scenarios: {
          activeId: 's1',
          changedIds: ['s1'],
          items: [
            { id: 'baseline', name: 'Baseline', overrides: {} },
            { id: 's1', name: 'Alpha', overrides: { f1: { start: '2026-01-01' } }, filters: { states: ['Doing'] }, view: { timelineScale: 'months' } },
          ],
        },
      },
      true,
      'test.saveScenarioHydrated'
    );

    await commands.saveScenario('s1');

    expect(store.getState().scenarios.changedIds).not.toContain('s1');
    saveSpy.mockRestore();
  });

  it('saveScenario clears the dirty flag without reloading the scenario list', async () => {
    const bus = { emit: vi.fn() };
    const saveSpy = vi.spyOn(dataService, 'saveScenario').mockResolvedValue({ ok: true, data: { id: 's1' } });
    const hydrateScenarioData = vi.fn().mockResolvedValue({ ok: true });
    const commands = createScenarioCommands(store, bus, null, { hydrateScenarioData });

    store.setState(
      {
        ...createInitialAppState(),
        scenarios: {
          activeId: 's1',
          changedIds: ['s1'],
          items: [
            { id: 'baseline', name: 'Baseline', overrides: {} },
            { id: 's1', name: 'Alpha', overrides: { f1: { start: '2026-01-01' } }, filters: { states: ['Doing'] }, view: { timelineScale: 'months' } },
          ],
        },
      },
      true,
      'test.saveScenarioDirtyFlagNoReload'
    );

    await commands.saveScenario('s1');

    expect(store.getState().scenarios.changedIds).not.toContain('s1');
    expect(store.getState().scenarios.items.map((scenario) => scenario.id)).toContain('s1');
    expect(hydrateScenarioData).not.toHaveBeenCalled();
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
    expect(store.getState().scenarios.changedIds).toContain('s2');
    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.UPDATED);
  });

  it('deleteScenario removes the item and falls back to baseline when active', () => {
    const bus = { emit: vi.fn() };
    const commands = createScenarioCommands(store, bus);

    commands.deleteScenario('s1');

    const ids = store.getState().scenarios.items.map((scenario) => scenario.id);
    expect(ids).toEqual(['s2']);
    expect(store.getState().scenarios.activeId).toBe('baseline');
    expect(bus.emit).toHaveBeenCalledWith(ScenarioEvents.ACTIVATED);
  });

  it('markActiveScenarioChanged toggles the canonical changedIds set once and reports status', () => {
    const bus = { emit: vi.fn() };
    const commands = createScenarioCommands(store, bus);

    const first = commands.markActiveScenarioChanged();
    const second = commands.markActiveScenarioChanged();

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(store.getState().scenarios.changedIds).toContain('s1');
  });
});
