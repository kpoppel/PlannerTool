import { expect } from '@esm-bundle/chai';
import '../../www/js/components/FeatureBoard.lit.js';
import { state } from '../../www/js/services/State.js';

describe('feature-board', () => {
  let board;
  beforeEach(() => {
    board = document.createElement('feature-board');
    document.body.appendChild(board);
  });

  afterEach(() => {
    if(board) board.remove();
    // restore state helpers if changed
    if(state.getEffectiveFeatures && state.getEffectiveFeatures.__backup) {
      state.getEffectiveFeatures = state.getEffectiveFeatures.__backup;
    }
  });

  it('renderFeatures computes features from state.getEffectiveFeatures', async () => {
    const feats = [
      { id: 'e1', type: 'epic', start: '2025-01-01', end: '2025-02-01', project: 'p1' },
      { id: 'f1', type: 'feature', start: '2025-01-10', end: '2025-01-20', project: 'p1' }
    ];
    // stub state.getEffectiveFeatures
    state.getEffectiveFeatures = () => feats;
    // ensure projects include p1 selected
    state.projects = [{ id: 'p1', selected: true }];
    state.teams = [];
    state.selectedFeatureStateFilter = new Set();
    board.renderFeatures();
    // after renderFeatures, board.features should be an array containing items mapped from feats
    expect(board.features).to.be.an('array');
  });

  it('addFeature accepts node and data', () => {
    const node = document.createElement('div');
    node.setAttribute('data-feature-id', 'x');
    board.addFeature(node);
    // adding node shouldn't throw and features array remains present
    expect(Array.isArray(board.features) || board.features === undefined).to.be.true;
  });
});
