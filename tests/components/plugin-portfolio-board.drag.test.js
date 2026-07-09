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

  it('shows failure feedback when state update is rejected', async () => {
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
    expect(el._statusMessage).to.equal('Failed to move F-2 to Doing');
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
});
