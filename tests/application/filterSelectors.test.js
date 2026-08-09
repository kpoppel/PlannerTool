import { describe, it, expect } from 'vitest';
import {
  createLegacyFilterSelectors,
  createFilterSelectors,
} from '../../www/js/application/selectors/filterSelectors.js';

describe('application/selectors/filterSelectors', () => {
  it('legacy selectors expose selected and available feature states', () => {
    const state = {
      selectedFeatureStateFilter: new Set(['In Progress', 'Done']),
      availableFeatureStates: ['New', 'In Progress', 'Done'],
    };

    const selectors = createLegacyFilterSelectors(state);
    expect(Array.from(selectors.getSelectedFeatureStateSet())).toEqual([
      'In Progress',
      'Done',
    ]);
    expect(selectors.getSelectedFeatureStateNames()).toEqual(['In Progress', 'Done']);
    expect(selectors.getAvailableFeatureStates()).toEqual(['New', 'In Progress', 'Done']);
  });

  it('store selectors read selected states from selection slice', () => {
    const store = {
      getState: () => ({
        selection: {
          featureStateNames: ['Open', 'Closed'],
        },
        baseline: {
          features: [],
        },
      }),
    };

    const selectors = createFilterSelectors(store);
    expect(Array.from(selectors.getSelectedFeatureStateSet())).toEqual(['Open', 'Closed']);
    expect(selectors.getSelectedFeatureStateNames()).toEqual(['Open', 'Closed']);
  });

  it('store selectors derive available states from baseline features when explicit list is absent', () => {
    const store = {
      getState: () => ({
        selection: {
          featureStateNames: [],
        },
        baseline: {
          features: [
            { id: 'f1', state: 'Todo' },
            { id: 'f2', state: 'Doing' },
            { id: 'f3', state: 'Todo' },
          ],
        },
      }),
    };

    const selectors = createFilterSelectors(store);
    expect(selectors.getAvailableFeatureStates()).toEqual(['Todo', 'Doing']);
  });
});
