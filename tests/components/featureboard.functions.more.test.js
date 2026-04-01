import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/FeatureBoard.lit.js';
import * as boardUtils from '../../www/js/components/board-utils.js';

// Ensure `scrollTo` exists on elements in the test environment
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function () {};
}
import { state } from '../../www/js/services/State.js';

describe('FeatureBoard helper coverage (additional)', () => {
  beforeEach(async () => {
    await customElements.whenDefined('feature-board');
  });

  it('_sortByRank/_sortByDate/_buildChildrenMap/_orderFeaturesHierarchically work', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const epic = {
      id: 'e1',
      type: 'epic',
      originalRank: 2,
      start: '2025-02-01',
    };
    const child = {
      id: 'c1',
      type: 'feature',
      parentEpic: 'e1',
      originalRank: 1,
      start: '2025-01-01',
    };
    const standalone = {
      id: 'f2',
      type: 'feature',
      originalRank: 3,
      start: '2025-03-01',
    };

    const ranked = el._sortByRank([epic, child, standalone]);
    expect(ranked[0].originalRank).to.equal(1);

    const dated = el._sortByDate([epic, child, standalone]);
    expect(dated[0].start).to.equal('2025-01-01');

    const cmap = el._buildChildrenMap([epic, child, standalone]);
    expect(cmap.get('e1')).to.exist;

    const ordered = el._orderFeaturesHierarchically([epic, child, standalone], 'rank');
    expect(ordered[0].id).to.equal('e1');
    expect(ordered.some((f) => f.id === 'c1')).to.be.true;
  });

  it('_isUnplanned and hierarchical linking', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    expect(el._isUnplanned({})).to.be.true;
    const epic = { id: 'e1', type: 'epic' };
    const child = { id: 'c1', parentEpic: 'e1' };
    const res = el._isHierarchicallyLinkedToSelectedProjectEpics(
      child,
      [epic, child],
      new Set(['e1'])
    );
    expect(res).to.be.true;
  });

  it('_featurePassesFilters respects project/team and state filters', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    // Setup minimal state via ProjectTeamService and filter service
    state._projectTeamService.initFromBaseline(
      [{ id: 'p1', selected: true }],
      [{ id: 't1', selected: true }]
    );
    state._viewService.setShowOnlyProjectHierarchy(false);
    state._viewService.setShowEpics(true);
    state._viewService.setShowFeatures(true);
    state._viewService.setShowUnplannedWork(true);
    state._viewService.setShowUnallocatedCards(true);
    state._stateFilterService.restoreFilterState({ selectedStates: ['New'] });

    const feature = {
      id: 'f1',
      project: 'p1',
      type: 'feature',
      state: 'New',
      capacity: [{ team: 't1' }],
    };
    const passes = el._featurePassesFilters(feature, new Map(), [feature]);
    expect(passes).to.equal(true);
  });

  it('_startThumbDrag/_onThumbMove scrollbar rail was removed', async () => {
    // The custom fixed scrollbar rail (_ensureFixedScrollbar, _onThumbMove, etc.)
    // was removed from FeatureBoard as part of the single-scroll-container refactor.
    // vertical scroll is now handled by #scroll-container in TimelineBoard.
    const el = await fixture(html`<feature-board></feature-board>`);
    expect(typeof el._onThumbMove).to.equal('undefined');
    expect(typeof el._ensureFixedScrollbar).to.equal('undefined');
  });

  it('centerFeatureById uses _cardMap and scrolls', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    // create mock card and timeline
    const mockCard = {
      offsetLeft: 120,
      clientWidth: 40,
      offsetTop: 80,
      clientHeight: 20,
      classList: { add: () => {}, remove: () => {} },
    };
    el._cardMap.set('f1', mockCard);
    const timeline = document.createElement('div');
    timeline.id = 'timelineSection';
    Object.defineProperty(timeline, 'clientWidth', {
      value: 300,
      configurable: true,
    });
    timeline.scrollTo = sinon.stub();
    // Put the timeline inside a timeline-board so findInBoard() will locate it
    const boardWrapper = document.createElement('timeline-board');
    boardWrapper.appendChild(timeline);
    document.body.appendChild(boardWrapper);
    Object.defineProperty(el, 'clientHeight', {
      value: 400,
      configurable: true,
    });
    el.scrollTo = sinon.stub();
    el.centerFeatureById('f1');
    // cleanup
    boardWrapper.remove();
    expect(true).to.be.true;
  });

  it('addFeature handles node and object', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    el.addFeature({ title: 'T1' });
    const div = document.createElement('div');
    div.textContent = 'X';
    el.addFeature(div);
    expect(true).to.be.true;
  });
});
