import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../../www/js/application/createInitialAppState.js';
import { createPluginScenarioDataCommands } from '../../../www/js/application/commands/pluginScenarioDataCommands.js';
import { store } from '../../../www/js/application/store.js';
import { bus } from '../../../www/js/core/EventBus.js';
import { ScenarioEvents } from '../../../www/js/core/EventRegistry.js';

function withScenarioState() {
  return {
    ...createInitialAppState(),
    scenarios: {
      activeId: 's1',
      changedIds: [],
      items: [
        { id: 'baseline', name: 'Baseline', readonly: true, overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: {} },
        { id: 's1', name: 'Alpha', overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: { 'plugin-annotations': [{ id: 'ann_1' }] } },
        { id: 's2', name: 'Beta', overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: {} },
      ],
    },
  };
}

describe('application/commands/pluginScenarioDataCommands', () => {
  let commands;

  beforeEach(() => {
    store.setState(withScenarioState(), true, 'test.resetStore');
    commands = createPluginScenarioDataCommands(store, bus);
    localStorage.clear();
  });

  it('get() reads a plugin key from the active scenario by default', () => {
    expect(commands.get(undefined, 'plugin-annotations')).toEqual([{ id: 'ann_1' }]);
  });

  it('get() returns an empty bag when the scenario has no plugin data', () => {
    expect(commands.get('s2')).toEqual({});
    expect(commands.get('s2', 'plugin-annotations')).toBeUndefined();
  });

  it('set() writes an opaque value under a plugin key and marks the scenario changed', () => {
    const emitSpy = vi.spyOn(bus, 'emit');
    const value = [{ id: 'ann_2', type: 'note' }];

    const result = commands.set('s2', 'plugin-annotations', value);

    expect(result).toBe(value);
    expect(commands.get('s2', 'plugin-annotations')).toBe(value);
    expect(store.getState().scenarios.changedIds).toContain('s2');
    expect(emitSpy).toHaveBeenCalledWith(ScenarioEvents.UPDATED);

    // Unrelated scenarios and plugin keys are untouched.
    expect(commands.get('s1', 'plugin-annotations')).toEqual([{ id: 'ann_1' }]);
  });

  it('set() rejects baseline and inactive read-only scenarios without persistence or events', () => {
    const state = store.getState();
    state.scenarios.items[2].readonly = true;
    const events = { emit: vi.fn() };
    const guarded = createPluginScenarioDataCommands(store, events);
    for (const id of ['baseline', 's2']) {
      expect(guarded.set(id, 'plugin-annotations', [{ id: 'ann_3' }])).toBeNull();
    }
    expect(store.getState()).toBe(state);
    expect(commands.get('baseline')).toEqual({});
    expect(localStorage.length).toBe(0);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('set() is a no-op for an unknown scenario id', () => {
    const before = store.getState();

    const result = commands.set('missing', 'plugin-annotations', [{ id: 'x' }]);

    expect(result).toBe(null);
    expect(store.getState()).toBe(before);
  });
});
