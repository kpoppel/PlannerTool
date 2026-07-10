import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/plugins/PluginPortfolioComponent.lit.js';
import { state } from '../../www/js/services/State.js';

describe('plugin-portfolio-board drag and drop', () => {
  let stateStubs = [];
  let originalViewService;
  let originalTaskFilterService;
  let originalColorService;

  beforeEach(() => {
    originalViewService = state._viewService;
    originalTaskFilterService = state._taskFilterService;
    originalColorService = state._colorService;

    stateStubs.push(
      sinon.stub(state, 'projects').get(() => [{ id: 'p1', name: 'Project One', selected: true }])
    );
    stateStubs.push(
      sinon.stub(state, 'teams').get(() => [
        { id: 't1', name: 'Team One', selected: true, color: '#2563eb' },
      ])
    );
    stateStubs.push(sinon.stub(state, 'availableFeatureStates').get(() => ['New', 'Doing']));
    stateStubs.push(sinon.stub(state, 'availableTaskTypes').get(() => ['Feature']));
    stateStubs.push(sinon.stub(state, 'selectedFeatureStateFilter').get(() => new Set()));
    stateStubs.push(sinon.stub(state, 'expansionState').get(() => ({}) ));

    state._taskFilterService = { featurePassesFilters: () => true };
    state._viewService = { isTypeVisible: () => true };
    state._colorService = { getProjectColor: () => '#0f766e' };
    stateStubs.push(sinon.stub(state, 'getFeatureStateColors').returns({
      New: { background: '#64748b', text: '#ffffff' },
      Doing: { background: '#16a34a', text: '#ffffff' },
    }));
  });

  afterEach(() => {
    sinon.restore();
    for (const stub of stateStubs) stub.restore();
    stateStubs = [];
    state._viewService = originalViewService;
    state._taskFilterService = originalTaskFilterService;
    state._colorService = originalColorService;
  });

  it('updates feature state on drop and shows success feedback', async () => {
    const feature = {
      id: 'F-1',
      title: 'Feature One',
      type: 'Feature',
      state: 'New',
      project: 'p1',
      capacity: [{ team: 't1', capacity: 50 }],
    };
    stateStubs.push(sinon.stub(state, 'getEffectiveFeatures').returns([feature]));
    const updateStub = sinon.stub(state, 'updateFeatureField').returns(true);
    stateStubs.push(updateStub);

    const el = await fixture(html`<plugin-portfolio-board></plugin-portfolio-board>`);
    el._handleDragStart(
      {
        dataTransfer: {
          effectAllowed: 'copy',
          setData: sinon.stub(),
        },
      },
      feature
    );
    el._handleDrop({ preventDefault() {} }, 'Doing');

    expect(updateStub.calledOnceWithExactly('F-1', 'state', 'Doing')).to.equal(true);
    expect(el._statusMessage).to.equal('Moved F-1 to Doing');
    expect(el._dragState.active).to.equal(false);
  });

  it('silently resets drag state when state update returns false', async () => {
    const feature = {
      id: 'F-2',
      title: 'Feature Two',
      type: 'Feature',
      state: 'New',
      project: 'p1',
      capacity: [{ team: 't1', capacity: 50 }],
    };
    stateStubs.push(sinon.stub(state, 'getEffectiveFeatures').returns([feature]));
    const updateStub = sinon.stub(state, 'updateFeatureField').returns(false);
    stateStubs.push(updateStub);

    const el = await fixture(html`<plugin-portfolio-board></plugin-portfolio-board>`);
    el._handleDragStart(
      {
        dataTransfer: {
          effectAllowed: 'copy',
          setData: sinon.stub(),
        },
      },
      feature
    );
    el._handleDrop({ preventDefault() {} }, 'Doing');

    expect(updateStub.calledOnceWithExactly('F-2', 'state', 'Doing')).to.equal(true);
    expect(el._statusMessage).to.not.equal('Failed to move F-2 to Doing');
    expect(el._dragState.active).to.equal(false);
  });

  it('suppresses click selection after pointer movement crosses threshold', async () => {
    const feature = {
      id: 'F-3',
      title: 'Feature Three',
      type: 'Feature',
      state: 'New',
      project: 'p1',
      capacity: [{ team: 't1', capacity: 50 }],
    };
    stateStubs.push(sinon.stub(state, 'getEffectiveFeatures').returns([feature]));
    const updateStub = sinon.stub(state, 'updateFeatureField').returns(true);
    stateStubs.push(updateStub);

    const el = await fixture(html`<plugin-portfolio-board></plugin-portfolio-board>`);
    el._handleCardPointerDown({ clientX: 10, clientY: 10 }, feature);
    el._handleGlobalPointerMove({ clientX: 16, clientY: 10 });
    el._selectFeature(feature);

    expect(el._selectedFeatureId).to.equal(null);

    el._suppressClickUntil = 0;
    el._selectFeature(feature);

    expect(el._selectedFeatureId).to.equal('F-3');
  });

  it('rejects drop when target team row differs from source row', async () => {
    const feature = {
      id: 'F-4',
      title: 'Feature Four',
      type: 'Feature',
      state: 'New',
      project: 'p1',
      capacity: [
        { team: 't1', capacity: 50 },
        { team: 't2', capacity: 30 },
      ],
    };
    stateStubs.push(sinon.stub(state, 'getEffectiveFeatures').returns([feature]));
    const updateStub = sinon.stub(state, 'updateFeatureField').returns(true);
    stateStubs.push(updateStub);

    const el = await fixture(html`<plugin-portfolio-board></plugin-portfolio-board>`);
    el._handleDragStart(
      {
        dataTransfer: {
          effectAllowed: 'copy',
          setData: sinon.stub(),
        },
      },
      feature,
      't1'
    );

    const dragEvent = {
      preventDefault: sinon.stub(),
      dataTransfer: { dropEffect: 'none' },
    };
    el._handleDragOver(dragEvent, 'Doing', 't2');
    expect(el._dragState.allowed).to.equal(false);
    expect(dragEvent.preventDefault.called).to.equal(false);

    el._handleDrop({ preventDefault() {} }, 'Doing', 't2');
    expect(updateStub.called).to.equal(false);
    expect(el._dragState.active).to.equal(false);
  });

  it('builds a timeline extent from the visible task date range', async () => {
    const features = [
      {
        id: 'F-10',
        title: 'First feature',
        type: 'Feature',
        state: 'New',
        project: 'p1',
        start: '2026-01-01',
        end: '2026-02-10',
        capacity: [{ team: 't1', capacity: 50 }],
      },
      {
        id: 'F-11',
        title: 'Last feature',
        type: 'Feature',
        state: 'Doing',
        project: 'p1',
        start: '2028-07-07',
        end: '2028-07-07',
        capacity: [{ team: 't1', capacity: 50 }],
      },
    ];
    stateStubs.push(sinon.stub(state, 'getEffectiveFeatures').returns(features));

    const el = await fixture(html`<plugin-portfolio-board></plugin-portfolio-board>`);
    const layout = el._timelineLayout;

    expect(layout.empty).to.equal(false);
    expect(layout.months[0].getFullYear()).to.equal(2026);
    expect(layout.months[0].getMonth()).to.equal(0);
    expect(layout.months[layout.months.length - 1].getFullYear()).to.equal(2028);
    expect(layout.months[layout.months.length - 1].getMonth()).to.equal(6);
    expect(layout.totalWidth).to.be.greaterThan(0);

    // Timeline overview starts collapsed by default.
    expect(el._timelineOpen).to.equal(false);
    expect(el.shadowRoot.querySelector('.timeline-svg-wrap')).to.not.exist;

    el._timelineOpen = true;
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.timeline-svg-wrap')).to.exist;
  });
});
