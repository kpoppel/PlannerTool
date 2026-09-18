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

  it('persists baseline annotations without special-casing storage in the plugin', () => {
    store.setState(
      withScenarios(
        [{ id: 'baseline', name: 'Baseline', readonly: true, overrides: {}, groupOverrides: {}, scenarioGroups: [], pluginData: {} }],
        'baseline'
      ),
      true,
      'test.resetStore'
    );
    state.reload();

    state.add({ id: 'ann_baseline', type: 'note' });

    const baseline = store.getState().scenarios.items.find((s) => s.id === 'baseline');
    expect(baseline.pluginData['plugin-annotations']).toEqual([{ id: 'ann_baseline', type: 'note' }]);
    // The scenario layer's local fallback store persisted it too, so a fresh
    // load of the initial state picks the annotation back up.
    expect(createInitialAppState().scenarios.items[0].pluginData['plugin-annotations']).toEqual([
      { id: 'ann_baseline', type: 'note' },
    ]);
  });
});
