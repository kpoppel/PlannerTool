import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createScenarioSelectors } from '../../www/js/application/selectors/scenarioSelectors.js';
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

  it('store selectors return active scenario and unsaved status', () => {
    const selectors = createScenarioSelectors(store);

    expect(selectors.getActiveScenarioId()).toBe('s2');
    expect(selectors.getActiveScenario()).toEqual({ id: 's2', name: 'Beta', isChanged: true });
    expect(selectors.isScenarioUnsaved({ isChanged: true })).toBe(true);
    expect(selectors.isActiveScenarioUnsaved()).toBe(true);
  });

});
