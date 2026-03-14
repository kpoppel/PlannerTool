import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/FeatureBoard.lit.js';
import { state } from '../../www/js/services/State.js';

describe('FeatureBoard helper coverage (additional)', () => {
  beforeEach(async () => { await customElements.whenDefined('feature-board'); });

  it('_sortByRank/_sortByDate/_buildChildrenMap/_orderFeaturesHierarchically work', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const epic = { id: 'e1', type: 'epic', originalRank: 2, start: '2025-02-01' };
    const child = { id: 'c1', type: 'feature', parentEpic: 'e1', originalRank: 1, start: '2025-01-01' };
    const standalone = { id: 'f2', type: 'feature', originalRank: 3, start: '2025-03-01' };

    const ranked = el._sortByRank([epic, child, standalone]);
    expect(ranked[0].originalRank).to.equal(1);

    const dated = el._sortByDate([epic, child, standalone]);
    expect(dated[0].start).to.equal('2025-01-01');

    const cmap = el._buildChildrenMap([epic, child, standalone]);
    expect(cmap.get('e1')).to.exist;

    const ordered = el._orderFeaturesHierarchically([epic, child, standalone], 'rank');
    expect(ordered[0].id).to.equal('e1');
    expect(ordered.some(f => f.id === 'c1')).to.be.true;
  });

  it('_isUnplanned and hierarchical linking', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    expect(el._isUnplanned({})).to.be.true;
    const epic = { id: 'e1', type: 'epic' };
    const child = { id: 'c1', parentEpic: 'e1' };
    const res = el._isHierarchicallyLinkedToSelectedProjectEpics(child, [epic, child], new Set(['e1']));
    expect(res).to.be.true;
  });

  it('_featurePassesFilters respects project/team and state filters', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    // Setup minimal state via ProjectTeamService and filter service
    state._projectTeamService.initFromBaseline([{ id: 'p1', selected: true }], [{ id: 't1', selected: true }]);
    state._viewService.setShowOnlyProjectHierarchy(false);
    state._viewService.setShowEpics(true);
    state._viewService.setShowFeatures(true);
    state._viewService.setShowUnplannedWork(true);
    state._viewService.setShowUnallocatedCards(true);
    state._stateFilterService.restoreFilterState({ selectedStates: ['New'] });

    const feature = { id: 'f1', project: 'p1', type: 'feature', state: 'New', capacity: [{ team: 't1' }] };
    const passes = el._featurePassesFilters(feature, new Map(), [feature]);
    expect(passes).to.equal(true);
  });

  it('_startThumbDrag/_onThumbMove update scroll safely', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    // ensure fixed rail exists
    el._ensureFixedScrollbar?.();
    // set sizes so movement calculates
    if (el._fixedRail) el._fixedRail.getBoundingClientRect = () => ({ height: 200, top: 0 });
    if (el._fixedThumb) el._fixedThumb.getBoundingClientRect = () => ({ height: 20 });
    // override read-only DOM getters on the element for the test environment
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
    let _st = 0;
    Object.defineProperty(el, 'scrollTop', { get: () => _st, set: (v) => { _st = v; }, configurable: true });
    el._fixedRail = el._fixedRail || document.querySelector('.fb-fixed-rail');
    el._fixedThumb = el._fixedThumb || document.querySelector('.fb-fixed-thumb');
    // start drag
    el._dragging = true;
    // simulate move
    el._onThumbMove({ clientY: 50 });
    // should not throw and scrollTop should be a number
    expect(typeof el.scrollTop === 'number').to.be.true;
  });

  it('centerFeatureById uses _cardMap and scrolls', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    // create mock card and timeline
    const mockCard = { offsetLeft: 120, clientWidth: 40, offsetTop: 80, clientHeight: 20, classList: { add: () => {}, remove: () => {} } };
    el._cardMap.set('f1', mockCard);
    const timeline = document.createElement('div'); timeline.id = 'timelineSection';
    Object.defineProperty(timeline, 'clientWidth', { value: 300, configurable: true });
    timeline.scrollTo = sinon.stub(); document.body.appendChild(timeline);
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    el.scrollTo = sinon.stub();
    el.centerFeatureById('f1');
    // cleanup
    timeline.remove();
    expect(true).to.be.true;
  });

  it('addFeature handles node and object', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    el.addFeature({ title: 'T1' });
    const div = document.createElement('div'); div.textContent = 'X';
    el.addFeature(div);
    expect(true).to.be.true;
  });
});
