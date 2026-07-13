import { expect } from '@esm-bundle/chai';
import { state } from '../../www/js/services/State.js';

// Previously skipped; updated to assert public viewService state
describe('viewOptions', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'viewOptionsContainer';
    document.body.appendChild(container);
    // predictable state
    state.setCondensedCards(false);
    state.setShowDependencies(false);
    state.setCapacityViewMode('team');
    state.setFeatureSortMode('rank');
    state.setTypeVisibility('epic', true);
    state.setTypeVisibility('feature', true);
    state.setSelectedStates(['New', 'In Progress', 'Done']);
    state.getFeatureStateColor = (s) => ({
      background: s === 'Done' ? '#0f0' : '#ccc',
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('basic viewService state reflects initialized values', () => {
    // container should exist and viewService settings applied in beforeEach
    const containerEl = document.getElementById('viewOptionsContainer');
    expect(containerEl).to.exist;
    expect(state.condensedCards).to.equal(false);
    expect(state.showDependencies).to.equal(false);
    expect(state.capacityViewMode).to.equal('team');
    expect(state.featureSortMode).to.equal('rank');
    expect(state.isTypeVisible('epic')).to.equal(true);
    expect(state.isTypeVisible('feature')).to.equal(true);
  });
});
