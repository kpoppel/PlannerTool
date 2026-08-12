import { describe, expect, it, beforeEach } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createFilterSelectors } from '../../www/js/application/selectors/filterSelectors.js';
import { store } from '../../www/js/application/store.js';

describe('PluginCostV1 selector seam', () => {
  beforeEach(() => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(createInitialAppState(), true, 'test.resetStore');
  });

  it('derives available states and state colors from the store', () => {
    // eslint-disable-next-line local/no-runtime-state-violations
    store.setState(
      (state) => ({
        ...state,
        baseline: {
          ...state.baseline,
          features: [
            { id: '1', state: 'New' },
            { id: '2', state: 'Doing' },
            { id: '3', state: 'Doing' },
          ],
        },
      }),
      false,
      'test.seedPluginCostV1States'
    );

    const sel = createFilterSelectors(store);
    const colors = sel.getFeatureStateColors();

    expect(sel.getAvailableFeatureStates()).to.deep.equal(['New', 'Doing']);
    expect(Object.keys(colors)).to.deep.equal(['New', 'Doing']);
    expect(colors.New.background).to.be.a('string');
    expect(colors.New.text).to.be.a('string');
  });
});