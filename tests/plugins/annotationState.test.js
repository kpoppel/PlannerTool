import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { bus } from '../../www/js/core/EventBus.js';
import { ScenarioEvents } from '../../www/js/core/EventRegistry.js';
import '../../www/js/application/imports.js';
import { getAnnotationState } from '../../www/js/plugins/annotations/AnnotationState.js';

function withScenarios(items, activeId) {
  return {
    ...createInitialAppState(),
    scenarios: { activeId, changedIds: [], items },
  };
}

describe('AnnotationState scenario integration', () => {
  const state = getAnnotationState();

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('reads annotations from the active scenario pluginData bag', () => {
    store.setState(
      withScenarios(
        [
          { id: 'baseline', name: 'Baseline', readonly: true, overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: {} },
          { id: 's1', name: 'Alpha', overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: { 'plugin-annotations': [{ id: 'ann_1', type: 'note' }] } },
        ],
        's1'
      ),
      true,
      'test.resetStore'
    );
    state.reload();

    expect(state.annotations).toEqual([{ id: 'ann_1', type: 'note' }]);
  });

  it('add() persists the new annotation onto the active scenario and marks it changed', () => {
    store.setState(
      withScenarios(
        [
          { id: 'baseline', name: 'Baseline', readonly: true, overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: {} },
          { id: 's1', name: 'Alpha', overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: {} },
        ],
        's1'
      ),
      true,
      'test.resetStore'
    );
    state.reload();

    state.add({ id: 'ann_new', type: 'note', text: 'hi' });

    const scenario = store.getState().scenarios.items.find((s) => s.id === 's1');
    expect(scenario.pluginData['plugin-annotations']).toEqual([{ id: 'ann_new', type: 'note', text: 'hi' }]);
    expect(store.getState().scenarios.changedIds).toContain('s1');
  });

  it('reloads its annotation set when the active scenario switches', () => {
    store.setState(
      withScenarios(
        [
          { id: 'baseline', name: 'Baseline', readonly: true, overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: {} },
          { id: 's1', name: 'Alpha', overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: { 'plugin-annotations': [{ id: 'ann_s1' }] } },
          { id: 's2', name: 'Beta', overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: { 'plugin-annotations': [{ id: 'ann_s2' }] } },
        ],
        's1'
      ),
      true,
      'test.resetStore'
    );
    state.reload();
    expect(state.annotations).toEqual([{ id: 'ann_s1' }]);

    store.setState(
      (current) => ({ ...current, scenarios: { ...current.scenarios, activeId: 's2' } }),
      false,
      'test.switchScenario'
    );
    bus.emit(ScenarioEvents.ACTIVATED);

    expect(state.annotations).toEqual([{ id: 'ann_s2' }]);
  });

  it('preserves baseline annotations without allowing local or persisted mutations', () => {
    store.setState(
      withScenarios(
        [{ id: 'baseline', name: 'Baseline', readonly: true, overrides: {}, groupOverrides: {}, scenarioGroups: [],
          pluginData: { 'plugin-annotations': [{ id: 'ann_baseline', type: 'note', text: 'Keep' }] } }],
        'baseline'
      ),
      true,
      'test.resetStore'
    );
    state.reload();

    const before = store.getState();
    expect(state.add({ id: 'new', type: 'note' })).toBeNull();
    expect(state.update('ann_baseline', { text: 'No' })).toBeNull();
    expect(state.remove('ann_baseline')).toBeNull();
    state.clear();
    expect(state.annotations).toEqual([{ id: 'ann_baseline', type: 'note', text: 'Keep' }]);
    expect(store.getState()).toBe(before);
    expect(localStorage.length).toBe(0);
  });
});
