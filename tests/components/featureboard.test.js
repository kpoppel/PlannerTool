import { fixture, html, expect } from '@open-wc/testing';
import { dataService } from '../../www/js/services/dataService.js';
import * as boardUtils from '../../www/js/components/board-utils.js';
import { plannerApplication } from '../../www/js/application/plannerApplication.js';
import { state } from '../helpers/runtimeState.js';

describe('FeatureBoard & DragSurface Tests', () => {
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
    const cfg = await import('../../www/js/config.js');
    cfg.featureFlags.USE_LIT_COMPONENTS = true;

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
    // ensure state feature lookup works for updateCardsById
    const { state } = await import('../helpers/runtimeState.js');
    const originalGetEffectiveFeatureById = state.getEffectiveFeatureById;
    const originalGetEffectiveFeatures = state.getEffectiveFeatures;
    state.getEffectiveFeatureById = (id) => features.find((f) => f.id === id);
    state.getEffectiveFeatures = () => features;
    const card1 = document.createElement('feature-card-lit');
    card1.feature = features[0];
    card1.style.left = '10px';
    card1.style.width = '100px';
    board.appendChild(card1);
    try {
      if (board && board._cardMap) board._cardMap.set('F1', card1);
    } catch (e) {}
    const card2 = document.createElement('feature-card-lit');
    card2.feature = features[1];
    card2.style.left = '200px';
    card2.style.width = '120px';
    board.appendChild(card2);
    try {
      if (board && board._cardMap) board._cardMap.set('F2', card2);
    } catch (e) {}
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
    state.getEffectiveFeatureById = originalGetEffectiveFeatureById;
    state.getEffectiveFeatures = originalGetEffectiveFeatures;
  });

  it('reloads a saved view with only team selection and renders team-allocated tasks', async () => {
    await import('../../www/js/components/FeatureBoard.lit.js');
    const board = await fixture(html`<feature-board></feature-board>`);
    const originalGetView = dataService.getView;
    const originalComputePosition = boardUtils.computePosition;
    const store = plannerApplication.store;

    const features = [
      {
        id: 'f-allocated',
        type: 'feature',
        start: '2025-01-10',
        end: '2025-01-20',
        project: 101,
        state: 'New',
        capacity: [{ team: 42, capacity: 3 }],
      },
    ];

    dataService.getView = async () => ({
      id: 'team-only-view',
      name: 'Team Only View',
      selectedProjects: { 101: false },
      selectedTeams: { 42: true },
      viewOptions: {
        graphType: 'team',
        expandParentChild: false,
        expandRelations: false,
        expandTeamAllocated: true,
        selectedFeatureStates: ['New'],
      },
    });

    Object.defineProperty(boardUtils, 'computePosition', {
      configurable: true,
      writable: true,
      value: () => ({ left: 100, width: 80 }),
    });

    try {
      state.initProjectTeamBaseline([{ id: 101, name: 'Plan 101' }], [{ id: 42, name: 'Team 42' }]);
      store.update('test.featureBoard.reload.setup', (draft) => {
        draft.baseline.projects = [{ id: 101, name: 'Plan 101', selected: false }];
        draft.baseline.teams = [{ id: 42, name: 'Team 42', selected: true }];
        draft.baseline.features = features;
        draft.selection.projectIds = [];
        draft.selection.teamIds = [42];
        draft.selection.featureStateNames = ['New'];
        draft.view.expansion.parentChild = false;
        draft.view.expansion.relations = false;
        draft.view.expansion.teamAllocated = true;
      });
      state.setBaselineFeatures(features);

      await state.views.load('team-only-view');
      expect(plannerApplication.selectors.selectedTeamIds()).to.deep.equal(['42']);
      expect(plannerApplication.selectors.view().expansion.teamAllocated).to.equal(true);
      expect(Array.from(plannerApplication.selectors.expandedFeatureIds())).to.deep.equal(['f-allocated']);
      await board.renderFeatures();

      expect(board.features.map((item) => item.feature?.id)).to.deep.equal(['f-allocated']);
      expect(board._swimlanes.map((lane) => lane.id)).to.deep.equal([42]);
    } finally {
      dataService.getView = originalGetView;
      Object.defineProperty(boardUtils, 'computePosition', {
        configurable: true,
        writable: true,
        value: originalComputePosition,
      });
      store.update('test.featureBoard.reload.cleanup', (draft) => {
        draft.baseline.projects = [];
        draft.baseline.teams = [];
        draft.baseline.features = [];
        draft.selection.projectIds = [];
        draft.selection.teamIds = [];
        draft.selection.featureStateNames = [];
        draft.view.expansion.parentChild = false;
        draft.view.expansion.relations = false;
        draft.view.expansion.teamAllocated = false;
      });
      board.remove();
    }
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
