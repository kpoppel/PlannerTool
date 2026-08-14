import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createScenarioSelectors } from '../../www/js/application/selectors/scenarioSelectors.js';
import { store } from '../../www/js/application/store.js';

describe('application/selectors/scenarioSelectors', () => {
  beforeEach(() => {
    store.setState(
      {
        ...createInitialAppState(),
        scenarios: {
          activeId: 's2',
          changedIds: ['s2'],
          items: [
            { id: 's1', name: 'Alpha' },
            { id: 's2', name: 'Beta' },
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
    expect(selectors.getActiveScenario()).toEqual({ id: 's2', name: 'Beta' });
    expect(selectors.isScenarioUnsaved({ id: 's2' })).toBe(true);
    expect(selectors.isActiveScenarioUnsaved()).toBe(true);
  });

  it('store selectors expose the canonical active scenario id without legacy fallback synthesis', () => {
    const selectors = createScenarioSelectors(store);

    expect(selectors.getScenarios()).toEqual([
      { id: 's1', name: 'Alpha' },
      { id: 's2', name: 'Beta' },
    ]);
    expect(selectors.getActiveScenarioId()).toBe('s2');
    expect(selectors.getActiveScenario()).toMatchObject({ id: 's2', name: 'Beta' });
  });

});
