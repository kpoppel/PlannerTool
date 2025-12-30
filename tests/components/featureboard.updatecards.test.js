import { expect } from '@esm-bundle/chai';
import '../../www/js/components/FeatureBoard.lit.js';
import { state } from '../../www/js/services/State.js';

describe('feature-board updateCardsById', () => {
  let board;
  beforeEach(() => {
    board = document.createElement('feature-board');
    document.body.appendChild(board);
    // minimal state
    state.projects = [{ id: 'p1', selected: true }];
    state.teams = [];
  });

  afterEach(() => {
    if (board) board.remove();
  });

  it('updateCardsById updates existing nodes via applyVisuals', async () => {
    // create a mocked feature node and cache it
    const node = document.createElement('div');
    node.feature = { id: 'f1', project: 'p1', selected: false };
    node.applyVisuals = function(opts){ this._applied = opts; };
    node.dataset.id = 'f1';
    board._cardMap.set('f1', node);

    const origGet = state.getEffectiveFeatureById;
    state.getEffectiveFeatureById = (id) => ({ id: 'f1', project: 'p1', start: '2025-01-01', end: '2025-01-31' });

    await board.updateCardsById(['f1']);
    expect(node._applied).to.exist;

    state.getEffectiveFeatureById = origGet;
  });

  it('updateCardsById falls back to full render when node missing', async () => {
    const origGet = state.getEffectiveFeatureById;
    state.getEffectiveFeatureById = (id) => ({ id: 'f2', project: 'p1', start: '2025-01-01', end: '2025-01-31' });
    let called = false;
    board.renderFeatures = function(){ called = true; };
    await board.updateCardsById(['f2']);
    expect(called).to.be.true;
    state.getEffectiveFeatureById = origGet;
  });
});
