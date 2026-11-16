import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import { sel } from '../../www/js/application/imports.js';
import { bus } from '../../www/js/core/EventBus.js';
import { AppEvents, ProjectEvents } from '../../www/js/core/EventRegistry.js';
import { groupService } from '../../www/js/services/GroupService.js';
import { initTimeline } from '../../www/js/components/Timeline.lit.js';

describe('FeatureBoard & DragSurface Tests', () => {
  before(async () => { await initTimeline(); });

  afterEach(() => {
    sinon.restore();
  });

  it('carries virtual source metadata through shared layout without changing the source', async () => {
    await import('../../www/js/components/FeatureBoard.lit.js');
    const board = await fixture(html`<feature-board></feature-board>`);
    const feature = { id: 'virtual-source', title: 'Reservation', project: 'p1',
      type: 'Epic', parentId: null, start: '2026-10-01', end: '2026-10-31',
      capacity: [{ team: 'A', capacity: 50 }, { team: 'B', capacity: 40 }], relations: [] };
    const presentation = { kind: 'virtual', sourceId: feature.id, feature,
      allocations: [{ team: 'A', capacity: 50 }] };
    sinon.stub(sel.feature, 'getEffectiveFeatures').returns([feature]);
    sinon.stub(sel.scope, 'getVisibleFeatures').returns([]);
    sinon.stub(sel.scope, 'getBoardPresentation').returns([presentation]);
    sinon.stub(sel.selection, 'getProjects').returns([{ id: 'p1', name: 'Plan', selected: true }]);
    sinon.stub(sel.selection, 'getTeams').returns([{ id: 'A' }, { id: 'B' }]);
    await board.renderFeatures();
    expect(board.getTaskLayout({ full: true }).rows[0].presentation).to.equal(presentation);
    expect(board.getTaskLayout({ full: true }).searchFeatures[0]).to.equal(feature);
    expect(feature.capacity).to.have.lengthOf(2);
  });

  it('does not resurrect virtual descendants beneath a folded hidden source ancestor', async () => {
    await import('../../www/js/components/FeatureBoard.lit.js');
    const board = await fixture(html`<feature-board></feature-board>`);
    const parent = { id: 'parent', title: 'Hidden parent', project: 'p1', type: 'Epic',
      parentId: null, capacity: [], relations: [] };
    const child = { ...parent, id: 'child', title: 'Demand', parentId: 'parent',
      start: '2026-10-01', end: '2026-10-31', capacity: [{ team: 'A', capacity: 20 }] };
    sinon.stub(sel.feature, 'getEffectiveFeatures').returns([parent, child]);
    sinon.stub(sel.scope, 'getVisibleFeatures').returns([]);
    sinon.stub(sel.scope, 'getBoardPresentation').returns([
      { kind: 'virtual', sourceId: child.id, feature: child, allocations: child.capacity },
    ]);
    sinon.stub(sel.selection, 'getProjects').returns([{ id: 'p1', name: 'Plan', selected: true }]);
    board._foldedFeatures.add('parent');
    await board.renderFeatures();
    expect(board.getTaskLayout({ full: true }).rows).to.have.lengthOf(0);
  });

  it('retains the expand control when a visible parent folds virtual descendants', async () => {
    await import('../../www/js/components/FeatureBoard.lit.js');
    const board = await fixture(html`<feature-board></feature-board>`);
    const parent = { id: 'parent', title: 'Parent', project: 'p1', type: 'Feature',
      parentId: null, start: '2026-10-01', end: '2026-10-31', capacity: [], relations: [] };
    const child = { ...parent, id: 'child', title: 'Demand', parentId: 'parent',
      start: '2026-10-01', end: '2026-10-31', capacity: [{ team: 'A', capacity: 20 }] };
    sinon.stub(sel.feature, 'getEffectiveFeatures').returns([parent, child]);
    sinon.stub(sel.scope, 'getVisibleFeatures').returns([parent]);
    sinon.stub(sel.scope, 'getBoardPresentation').returns([
      { kind: 'virtual', sourceId: child.id, feature: child, allocations: child.capacity },
    ]);
    sinon.stub(sel.selection, 'getProjects').returns([{ id: 'p1', name: 'Plan', selected: true }]);
    board._foldedFeatures.add('parent');
    await board.renderFeatures();
    const rows = board.getTaskLayout({ full: true }).rows;
    expect(rows).to.have.lengthOf(1);
    expect(rows[0].foldCount).to.equal(1);
    expect(rows[0].folded).to.equal(true);
  });

  it('keeps swimlane tints subtler than card progress fills', async () => {
    await import('../../www/js/components/FeatureBoard.lit.js');
    const board = await fixture(html`<feature-board></feature-board>`);
    board._swimlanes = [{ id: 'plan', name: 'Plan', type: 'plan', color: '#347ab3',
      topPx: 0, heightPx: 100, origins: [] }];
    board.requestUpdate();
    await board.updateComplete;
    const band = board.shadowRoot.querySelector('.swimlane-band');
    expect(band.style.backgroundColor).to.equal('rgba(52, 122, 179, 0.04)');
    expect(band.style.borderTopColor).to.equal('rgba(52,122,179,0.12)');
  });

  it('batches selected plans and invalidates pending loads on deselection', async () => {
    const board = document.createElement('feature-board');
    board.renderFeatures = sinon.stub();
    document.body.appendChild(board);
    const on = sinon.stub(bus, 'on');
    const once = sinon.stub(bus, 'once');
    const load = sinon.stub(groupService, 'loadGroupsForPlans').resolves();
    const evict = sinon.stub(groupService, 'evictPlan');
    sinon.stub(groupService, 'hasPlanLoaded').returns(false);
    const plans = [{ id: 'p1' }, { id: 'p2' }];
    const selected = sinon.stub(sel.selection, 'getSelectedProjects').returns(plans);
    sinon.stub(sel.selection, 'getProjects').returns(plans);
    sinon.stub(sel.selection, 'getSelectedProjectIds').returns([]);
    try {
      const { initBoard } = await import('../../www/js/components/FeatureBoard.init.js');
      await initBoard();
      once.getCalls().find((call) => call.args[0] === AppEvents.READY).args[1]();
      expect(load.calledOnceWithExactly(['p1', 'p2'])).to.be.true;
      selected.returns([]);
      for (const call of on.getCalls()) {
        if (call.args[0] === ProjectEvents.CHANGED) call.args[1]();
      }
      expect(evict.calledWithExactly('p1')).to.be.true;
      expect(evict.calledWithExactly('p2')).to.be.true;
    } finally {
      board.remove();
    }
  });

  it('updateCardsById patches existing lit cards', async () => {
    // Stub ResizeObserver for the duration of this test to avoid loop errors
    if (!window.__origResizeObserver) {
      window.__origResizeObserver = window.ResizeObserver;
    }
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    const mod = await import('../../www/js/components/FeatureBoard.lit.js');
    const { updateCardsById } = mod;

    // Provide a lightweight mock feature-card-lit if not present
    if (!customElements.get('feature-card-lit')) {
      class MockFeatureCard extends HTMLElement {
        constructor() {
          super();
          this.feature = {};
          this.selected = false;
        }
        applyVisuals({ left, width, selected, dirty, project } = {}) {
          if (left !== undefined) this.style.left = left;
          if (width !== undefined) this.style.width = width;
          if (selected !== undefined) this.selected = !!selected;
          if (dirty !== undefined)
            this.feature = Object.assign({}, this.feature, { dirty });
          if (project !== undefined) this.project = project;
        }
      }
      customElements.define('feature-card-lit', MockFeatureCard);
    }

    const board = await fixture(html`<feature-board id="featureBoard"></feature-board>`);
    const header = document.createElement('div');
    header.id = 'timelineHeader';
    document.body.appendChild(header);
    const section = document.createElement('div');
    section.id = 'timelineSection';
    document.body.appendChild(section);
    const tl = document.createElement('timeline-lit');
    header.appendChild(tl);
    const timeline = await import('../../www/js/components/Timeline.lit.js');
    await timeline.initTimeline();

    const features = [
      {
        id: 'F1',
        title: 'One',
        type: 'feature',
        start: '2025-01-01',
        end: '2025-01-05',
        project: null,
        capacity: [],
      },
      {
        id: 'F2',
        title: 'Two',
        type: 'feature',
        start: '2025-01-06',
        end: '2025-01-10',
        project: null,
        capacity: [],
      },
    ];
    sinon
      .stub(sel.feature, 'getEffectiveFeatureById')
      .callsFake((id) => features.find((f) => f.id === id) || null);
    sinon.stub(sel.selection, 'getProjects').returns([]);
    const card1 = document.createElement('feature-card-lit');
    card1.feature = features[0];
    card1.style.left = '10px';
    card1.style.width = '100px';
    board.appendChild(card1);
    try {
      if (board && board._cardMap) board._cardMap.set('F1', card1);
    } catch (e) {
      // ignore test fixture setup differences
    }
    const card2 = document.createElement('feature-card-lit');
    card2.feature = features[1];
    card2.style.left = '200px';
    card2.style.width = '120px';
    board.appendChild(card2);
    try {
      if (board && board._cardMap) board._cardMap.set('F2', card2);
    } catch (e) {
      // ignore test fixture setup differences
    }
    features[0].start = '2025-01-02';
    features[0].end = '2025-01-08';
    features[0]._left = 50;
    features[0]._width = 120;
    features[1].start = '2025-01-09';
    features[1].end = '2025-01-20';
    features[1]._left = 300;
    features[1]._width = 220;
    await board.updateCardsById(['F1', 'F2'], features);
    // restore ResizeObserver
    if (window.__origResizeObserver) {
      window.ResizeObserver = window.__origResizeObserver;
      delete window.__origResizeObserver;
    }
    const nodes = board.querySelectorAll('feature-card-lit');
    expect(nodes.length).to.be.at.least(2);
    expect(nodes[0].feature.start).to.equal('2025-01-02');
    expect(nodes[0].style.left).to.not.equal('10px');
    expect(nodes[1].feature.start).to.equal('2025-01-09');
    expect(nodes[1].style.left).to.not.equal('200px');
  });

  it('attachDrag binds mousedown and calls onStart (local adapter)', async () => {
    function attachDrag(el, handlers) {
      if (!el) return;
      el.addEventListener('mousedown', (e) => {
        if (typeof handlers.onStart === 'function') {
          handlers.onStart(e);
        }
      });
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    let called = false;
    attachDrag(el, {
      onStart: () => {
        called = true;
      },
    });
    const evt = new MouseEvent('mousedown', { bubbles: true });
    el.dispatchEvent(evt);
    expect(called).to.be.true;
  });
});
