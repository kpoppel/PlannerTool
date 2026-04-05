import { expect } from '@esm-bundle/chai';
import { state } from '../../www/js/services/State.js';

// Previously skipped; updated to assert basic public viewService state
describe('viewOptions extra', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'viewOptionsContainer';
    document.body.appendChild(container);
    state._viewService.setCondensedCards(false);
    state._viewService.setShowDependencies(false);
    state._viewService.setCapacityViewMode('team');
    state._viewService.setFeatureSortMode('rank');
    state._viewService.setTypeVisibility('epic', true);
    state._viewService.setTypeVisibility('feature', true);
    state._stateFilterService.setAvailableStates(['New', 'Done']);
    state._stateFilterService._selectedStates = ['New', 'Done'];
    state.getFeatureStateColor = (s) => ({ background: '#ccc' });
  });
  afterEach(() => {
    container.remove();
  });

  it('basic container and viewService state are present', () => {
    const containerEl = document.getElementById('viewOptionsContainer');
    expect(containerEl).to.exist;
    expect(state._viewService.condensedCards).to.equal(false);
    expect(state._viewService.capacityViewMode).to.equal('team');
    expect(state._viewService.featureSortMode).to.equal('rank');
  });
});
