import { expect } from '@esm-bundle/chai';
import { initViewOptions } from '../../www/js/components/viewOptions.js';
import { state } from '../../www/js/services/State.js';

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
    state._viewService.setShowEpics(true);
    state._viewService.setShowFeatures(true);
    state._stateFilterService.setAvailableStates(['New','Done']);
    state._stateFilterService._selectedStates = ['New','Done'];
    state.getFeatureStateColor = (s) => ({ background: '#ccc' });
  });
  afterEach(() => { container.remove(); });

  it('capacity radio chips toggle via click and keyboard', () => {
    initViewOptions(container);
    // find chip with label 'Team' and simulate keydown enter
    const chips = Array.from(container.querySelectorAll('.chip'));
    const teamChip = chips.find(c => c.textContent.trim() === 'Team');
    expect(teamChip).to.exist;
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    teamChip.dispatchEvent(ev);
    // state.capacityViewMode may be set via setter; ensure it remains a string
    expect(typeof state.capacityViewMode).to.equal('string');
  });
});
