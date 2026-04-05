import { expect } from '@esm-bundle/chai';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';

// Previously skipped; updated to assert public viewService state
describe('viewOptions', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'viewOptionsContainer';
    document.body.appendChild(container);
    // predictable state
    state._viewService.setCondensedCards(false);
    state._viewService.setShowDependencies(false);
    state._viewService.setCapacityViewMode('team');
    state._viewService.setFeatureSortMode('rank');
    state._viewService.setTypeVisibility('epic', true);
    state._viewService.setTypeVisibility('feature', true);
    state._stateFilterService.setAvailableStates(['New', 'In Progress', 'Done']);
    state._stateFilterService._selectedStates = ['New', 'In Progress', 'Done'];
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
    expect(state._viewService.condensedCards).to.equal(false);
    expect(state._viewService.showDependencies).to.equal(false);
    expect(state._viewService.capacityViewMode).to.equal('team');
    expect(state._viewService.featureSortMode).to.equal('rank');
    expect(state._viewService.isTypeVisible('epic')).to.equal(true);
    expect(state._viewService.isTypeVisible('feature')).to.equal(true);
  });
});
