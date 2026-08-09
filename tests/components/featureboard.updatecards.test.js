import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import '../../www/js/components/FeatureBoard.lit.js';
import { sel } from '../../www/js/application/imports.js';

describe('feature-board updateCardsById', () => {
  let board;
  beforeEach(() => {
    board = document.createElement('feature-board');
    document.body.appendChild(board);
  });

  afterEach(() => {
    if (board) board.remove();
    sinon.restore();
  });

  it('updateCardsById updates existing nodes via applyVisuals', async () => {
    // create a mocked feature node and cache it
    const node = document.createElement('div');
    node.feature = { id: 'f1', project: 'p1', selected: false };
    node.applyVisuals = function (opts) {
      this._applied = opts;
    };
    node.dataset.id = 'f1';
    board._cardMap.set('f1', node);

    sinon.stub(sel.feature, 'getEffectiveFeatureById').callsFake((id) => ({
      id: 'f1',
      project: 'p1',
      start: '2025-01-01',
      end: '2025-01-31',
    }));
    sinon.stub(sel.selection, 'getProjects').returns([{ id: 'p1', selected: true }]);

    await board.updateCardsById(['f1']);
    expect(node._applied).to.exist;
  });

  it('updateCardsById falls back to full render when node missing', async () => {
    sinon.stub(sel.feature, 'getEffectiveFeatureById').callsFake((id) => ({
      id: 'f2',
      project: 'p1',
      start: '2025-01-01',
      end: '2025-01-31',
    }));
    let called = false;
    board.renderFeatures = function () {
      called = true;
    };
    await board.updateCardsById(['f2']);
    expect(called).to.be.true;
  });
});
