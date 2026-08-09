import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyScenarioSelectors,
  createScenarioSelectors,
} from '../../www/js/application/selectors/scenarioSelectors.js';
import { store } from '../../www/js/application/store.js';

describe('application/selectors/scenarioSelectors', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(
      {
        ...createInitialAppState(),
        scenarios: {
          activeId: 's2',
          items: [
            { id: 's1', name: 'Alpha', isChanged: false },
            { id: 's2', name: 'Beta', isChanged: true },
          ],
        },
      },
      true,
      'test.resetStore'
    );
  });

  it('legacy selectors delegate to state methods and fields', () => {
    const state = {
      scenarios: [{ id: 'legacy-1' }],
      activeScenarioId: 'legacy-1',
      getActiveScenario: vi.fn(() => ({ id: 'legacy-1', isChanged: true })),
      isScenarioUnsaved: vi.fn(() => true),
    };

    const selectors = createLegacyScenarioSelectors(state);

    expect(selectors.getScenarios()).toEqual([{ id: 'legacy-1' }]);
    expect(selectors.getActiveScenarioId()).toBe('legacy-1');
    expect(selectors.getActiveScenario()).toEqual({ id: 'legacy-1', isChanged: true });
    expect(selectors.isActiveScenarioUnsaved()).toBe(true);
    expect(state.isScenarioUnsaved).toHaveBeenCalled();
  });

  it('store selectors return active scenario and unsaved status', () => {
    const selectors = createScenarioSelectors(store);

    expect(selectors.getActiveScenarioId()).toBe('s2');
    expect(selectors.getActiveScenario()).toEqual({ id: 's2', name: 'Beta', isChanged: true });
    expect(selectors.isScenarioUnsaved({ isChanged: true })).toBe(true);
    expect(selectors.isActiveScenarioUnsaved()).toBe(true);
  });
});
