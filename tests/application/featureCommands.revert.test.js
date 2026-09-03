import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeatureCommands } from '../../www/js/application/commands/featureCommands.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { store } from '../../www/js/application/store.js';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('application/commands/featureCommands revertFeature', () => {
  beforeEach(() => {
    const state = createInitialAppState();
    state.baseline.features = [{ id: 'f1', start: null, end: null }];
    state.scenarios.activeId = 'scenario-1';
    state.scenarios.items.push({
      id: 'scenario-1',
      name: 'Scenario 1',
      readonly: false,
      overrides: {
        f1: { start: '2026-06-01', end: '2026-07-15' },
      },
      groupOverrides: {},
      scenarioGroups: [],
    });
    store.setState(state, true, 'test.resetStore');
  });

  it('emits ids so the board reapplies unplanned geometry incrementally', () => {
    const eventBus = { emit: vi.fn() };
    const commands = createFeatureCommands(store, eventBus, vi.fn());

    commands.revertFeature('f1');

    expect(eventBus.emit).toHaveBeenCalledWith(FeatureEvents.UPDATED, {
      ids: ['f1'],
      type: 'revert',
    });
  });
});