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

  it('updateCardsById falls back to full render when the feature belongs to a group', async () => {
    // A grouped task's band must be recalculated (it may move beyond the
    // group's current date range), so a plain applyVisuals patch is not enough.
    const node = document.createElement('div');
    node.feature = { id: 'f3', project: 'p1', selected: false };
    node.applyVisuals = function (opts) {
      this._applied = opts;
    };
    node.dataset.id = 'f3';
    board._cardMap.set('f3', node);

    sinon.stub(sel.feature, 'getEffectiveFeatureById').callsFake(() => ({
      id: 'f3',
      project: 'p1',
      start: '2025-01-01',
      end: '2025-01-31',
    }));
    sinon.stub(sel.selection, 'getProjects').returns([{ id: 'p1', selected: true }]);
    sinon.stub(sel.group, 'hasPlanLoaded').returns(true);
    sinon.stub(sel.group, 'getEffectiveGroups').returns([{ id: 'g1', members: ['f3'] }]);

    let called = false;
    board.renderFeatures = function () {
      called = true;
    };

    await board.updateCardsById(['f3']);
    expect(called).to.be.true;
    expect(node._applied).to.not.exist;
  });

  it('keeps an unallocated Context task accepted by the canonical visible scope', () => {
    sinon.stub(sel.view, 'getExpansionState').returns({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    });
    sinon.stub(sel.view, 'getShowOnlyProjectHierarchy').returns(false);
    sinon.stub(sel.view, 'isTypeVisible').returns(true);
    sinon.stub(sel.view, 'getShowUnplannedWork').returns(true);
    sinon.stub(sel.view, 'getShowUnassignedCards').returns(false);
    sinon.stub(sel.filter, 'getSelectedFeatureStateSet').returns(new Set(['active']));
    sinon.stub(sel.filter, 'featurePassesFilters').returns(true);
    sinon.stub(sel.selection, 'getProjects').returns([{ id: 'selected', selected: true }]);
    sinon.stub(sel.selection, 'getSelectedProjectIds').returns(['selected']);
    sinon.stub(sel.selection, 'getSelectedTeamIds').returns([]);

    const contextTask = {
      id: 'parent-task',
      project: 'parent',
      capacity: [],
      state: 'active',
      type: 'Feature',
    };

    expect(board._featurePassesFilters(
      contextTask,
      new Map(),
      [contextTask],
      new Set(['parent-task'])
    )).to.equal(true);
  });
});
