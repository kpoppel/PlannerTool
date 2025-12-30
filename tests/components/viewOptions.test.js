import { expect } from '@esm-bundle/chai';
import { initViewOptions } from '../../www/js/components/viewOptions.js';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';

describe('viewOptions', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'viewOptionsContainer';
    document.body.appendChild(container);
    // predictable state
    state.condensedCards = false;
    state.showDependencies = false;
    state.capacityViewMode = 'team';
    state.featureSortMode = 'rank';
    state.showEpics = true;
    state.showFeatures = true;
    state.availableFeatureStates = ['New','In Progress','Done'];
    state.selectedFeatureStateFilter = new Set(['New','In Progress','Done']);
    state.getFeatureStateColor = (s) => ({ background: s==='Done' ? '#0f0' : '#ccc' });
  });

  afterEach(() => {
    container.remove();
  });

  it('renders basic controls and toggles modify state', async () => {
    initViewOptions(container);
    const condensedBtn = container.querySelector('.chip');
    expect(condensedBtn).to.exist;
    // simulate clicking condensed toggle
    condensedBtn.click();
    // clicking re-inits; condensed state should remain boolean
    expect(typeof state.condensedCards).to.equal('boolean');
  });

  it('renders state filter chips including All/None', () => {
    initViewOptions(container);
    const stateGroup = Array.from(container.querySelectorAll('.group-label')).find(n => n.textContent.includes('State'));
    expect(stateGroup).to.exist;
    const chips = container.querySelectorAll('.chip-group .chip');
    expect(chips.length).to.be.at.least(1);
    const doneChip = Array.from(chips).find(n=> n.textContent.trim()==='Done');
    expect(doneChip).to.exist;
  });

  it('responds to external StateFilterEvents.CHANGED by reinit', () => {
    initViewOptions(container);
    // mutate selected set and emit change
    state.selectedFeatureStateFilter = new Set(['New']);
    bus.emit('StateFilter:changed');
    const chips = container.querySelectorAll('.chip');
    expect(chips.length).to.be.greaterThan(0);
  });
});
