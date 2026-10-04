import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { sel } from '../../www/js/application/imports.js';
import { initTimeline, _resetTimelineState } from '../../www/js/components/Timeline.lit.js';
import '../../www/js/components/FeatureBoard.lit.js';
import '../../www/js/components/FeatureCard.lit.js';

// Ensure `scrollTo` exists on elements in the test environment
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function () {};
}
describe('FeatureBoard navigation, insertion and viewport behavior', () => {
  beforeEach(async () => {
    await customElements.whenDefined('feature-board');
  });

  it('centers the requested card in the scroll container and highlights it', async () => {
    const wrapper = await fixture(html`
      <div>
        <div id="scroll-container"></div>
        <feature-board></feature-board>
      </div>
    `);
    document.querySelector('timeline-board').appendChild(wrapper);
    const el = wrapper.querySelector('feature-board');
    await el.updateComplete;
    const card = document.createElement('feature-card-lit');
    card.dataset.featureId = 'f1';
    Object.defineProperties(card, {
      offsetLeft: { value: 520 },
      clientWidth: { value: 40 },
      offsetTop: { value: 480 },
      clientHeight: { value: 20 },
    });
    el.shadowRoot.appendChild(card);
    const scrollContainer = wrapper.querySelector('#scroll-container');
    Object.defineProperties(scrollContainer, {
      clientWidth: { value: 300 },
      clientHeight: { value: 400 },
    });
    scrollContainer.scrollTo = sinon.stub();

    el.centerFeatureById('f1');

    expect(scrollContainer.scrollTo.calledOnceWithExactly({
      left: 390, top: 290, behavior: 'smooth',
    })).to.be.true;
    expect(card.classList.contains('search-highlight')).to.be.true;
    const render = sinon.stub(el, 'renderFeatures').resolves();
    await el.setReconciliationContext(null);
    expect(card.classList.contains('search-highlight')).to.be.false;
    render.restore();
  });

  it('mounts and highlights a navigation target outside the current virtualized slice', async () => {
    const wrapper = await fixture(html`<div><div id="scroll-container"></div><feature-board></feature-board></div>`);
    document.querySelector('timeline-board').appendChild(wrapper);
    const el = wrapper.querySelector('feature-board');
    await el.updateComplete;
    const target = { feature: { id: 'offscreen', title: 'Offscreen task', type: 'Feature',
      project: 'project', state: 'Active', start: '2026-10-01', end: '2026-10-10',
      parentId: null, capacity: [], relations: [] }, teams: [], condensed: false,
      project: { id: 'project', name: 'Plan', color: '#23344d', state_categories: { Active: 'InProgress' } },
      left: 1800, width: 40, top: 4000 };
    el._fullRenderList = [target];
    const scrollContainer = wrapper.querySelector('#scroll-container');
    scrollContainer.scrollTo = sinon.stub();
    await el.centerFeatureById('offscreen');
    const card = el.shadowRoot.querySelector('[data-feature-id="offscreen"]');
    expect(card).not.to.equal(null);
    expect(card.classList.contains('search-highlight')).to.be.true;
    sinon.stub(el, '_shouldVirtualize').returns(true);
    sinon.stub(el, '_computeVisibleRenderItems').returns([]);
    el._updateVisibleRenderList();
    expect(el.features).to.deep.equal([target]);
  });

  it('temporarily filters review context, reveals folded tasks and restores ordinary scope', async () => {
    const state = createInitialAppState();
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Plan', type: 'project',
      task_type_hierarchy: [{ types: ['Epic'] }, { types: ['Feature'] }],
      state_categories: { Active: 'InProgress' }, color: '#23344d' }];
    const parent = { id: 'parent', title: 'Parent', project: 'project', type: 'Epic',
      state: 'Active', start: '2026-10-01', end: '2026-10-10', parentId: null,
      capacity: [], relations: [] };
    state.baseline.features = [parent, { ...parent, id: 'child', type: 'Feature', parentId: 'parent' },
      { ...parent, id: 'other', type: 'Feature' }];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Active'];
    state.selection.taskTypeNames = ['Feature'];
    store.setState(state, true);
    _resetTimelineState();
    await initTimeline();
    const el = await fixture(html`<feature-board></feature-board>`);
    const viewBefore = store.getState().view;
    const visibleBefore = sel.scope.getVisibleFeatures();
    el._foldedFeatures.add('parent');
    const groups = sinon.stub(sel.group, 'getDisplayGroupsForSelectedPlans').returns([
      { id: 'review-group', plan_id: 'project', name: 'Delivery group',
        members: ['parent', 'child'], color: '#23344d', rank: 10 },
    ]);
    el._collapsedGroups.add('review-group');
    await el.setReconciliationContext({ filter: true, featureIds: new Set(['parent', 'child']) });
    expect(el._fullRenderList.filter((item) => !item.isGroup).map((item) => item.feature.id))
      .to.deep.equal(['parent', 'child']);
    expect(sel.scope.getVisibleFeatures()).to.equal(visibleBefore);
    expect(store.getState().view).to.equal(viewBefore);
    expect(el._foldedFeatures.has('parent')).to.be.true;
    expect(el.shadowRoot.querySelector('feature-group').collapsed).to.be.false;
    await el.setReconciliationContext({ filter: false, featureIds: new Set(['parent', 'child']) });
    expect(el._fullRenderList.filter((item) => !item.isGroup).map((item) => item.feature.id))
      .to.include('other');
    await el.setReconciliationContext(null);
    expect(el._fullRenderList.filter((item) => !item.isGroup).map((item) => item.feature.id))
      .to.deep.equal(['other']);
    expect(el._collapsedGroups.has('review-group')).to.be.true;
    expect(el.shadowRoot.querySelector('feature-group').collapsed).to.be.true;
    groups.restore();
    store.setState(createInitialAppState(), true);
  });

  it('adds feature titles and supplied nodes as visible board content', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    el.addFeature({ title: 'T1' });
    expect(el.querySelector('[role="listitem"]').textContent).to.equal('T1');
    const div = document.createElement('div');
    div.textContent = 'X';
    el.addFeature(div);
    expect(div.parentElement).to.equal(el);
    expect(el.textContent).to.contain('X');
  });

  it('_computeVisibleRenderItems returns only viewport-intersecting items', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const items = [
      { feature: { id: 'visible-1' }, left: 0, width: 100, top: 0 },
      { feature: { id: 'visible-2' }, left: 120, width: 100, top: 80 },
      { feature: { id: 'hidden-y' }, left: 0, width: 100, top: 2000 },
      { feature: { id: 'hidden-x' }, left: 3000, width: 100, top: 0 },
    ];

    const visible = el._computeVisibleRenderItems(items, {
      left: 0,
      right: 400,
      top: 0,
      bottom: 300,
      overscanX: 0,
      overscanY: 0,
    });

    expect(visible.map((item) => item.feature.id)).to.deep.equal([
      'visible-1',
      'visible-2',
    ]);
  });
});
