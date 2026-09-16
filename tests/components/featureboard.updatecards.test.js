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

  it('updateCardsById falls back to full render for a contextual task in a selected mother-plan group', async () => {
    // A grouped task's band must be recalculated (it may move beyond the
    // group's current date range), so a plain applyVisuals patch is not enough.
    const node = document.createElement('div');
    node.feature = { id: 'f3', project: 'p2', selected: false };
    node.applyVisuals = function (opts) {
      this._applied = opts;
    };
    node.dataset.id = 'f3';
    board._cardMap.set('f3', node);

    sinon.stub(sel.feature, 'getEffectiveFeatureById').callsFake(() => ({
      id: 'f3',
      project: 'p2',
      start: '2025-01-01',
      end: '2025-01-31',
    }));
    sinon.stub(sel.selection, 'getProjects').returns([{ id: 'p1', selected: true }]);
    sinon.stub(sel.group, 'hasPlanLoaded').callsFake((planId) => planId === 'p1');
    sinon.stub(sel.group, 'getEffectiveGroups').callsFake((planId) =>
      planId === 'p1' ? [{ id: 'g1', members: ['f3'] }] : []
    );

    let called = false;
    board.renderFeatures = function () {
      called = true;
    };

    await board.updateCardsById(['f3']);
    expect(called).to.be.true;
    expect(node._applied).to.not.exist;
  });

});
