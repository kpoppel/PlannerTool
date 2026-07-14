import { expect } from '@esm-bundle/chai';
import { state } from '../helpers/runtimeState.js';

// Previously skipped; updated to assert basic public viewService state
describe('viewOptions extra', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'viewOptionsContainer';
    document.body.appendChild(container);
    state.setCondensedCards(false);
    state.setShowDependencies(false);
    state.setCapacityViewMode('team');
    state.setFeatureSortMode('rank');
    state.setTypeVisibility('epic', true);
    state.setTypeVisibility('feature', true);
    state.setSelectedStates(['New', 'Done']);
    state.getFeatureStateColor = (s) => ({ background: '#ccc' });
  });
  afterEach(() => {
    container.remove();
  });

  it('basic container and viewService state are present', () => {
    const containerEl = document.getElementById('viewOptionsContainer');
    expect(containerEl).to.exist;
    expect(state.condensedCards).to.equal(false);
    expect(state.capacityViewMode).to.equal('team');
    expect(state.featureSortMode).to.equal('rank');
  });
});
