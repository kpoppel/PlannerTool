import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/plugins/PluginPortfolioComponent.lit.js';

describe('plugin-portfolio-board drag and drop', () => {
  let features;
  let updateFeature;
  let api;

  function createApi() {
    return {
      features: {
        list: () => features,
        updateField: updateFeature,
        passesTaskFilters: () => true,
      },
      selection: {
        getProjects: () => [{ id: 'p1', name: 'Project One', selected: true }],
        getTeams: () => [{ id: 't1', name: 'Team One', selected: true, color: '#2563eb' }],
        getExpansionState: () => ({}),
        getExpandedFeatureIds: () => new Set(),
      },
      filters: {
        getFeatureStates: () => ['New', 'Doing'],
        getAvailableFeatureStates: () => ['New', 'Doing'],
        compareFeatureStates: (left, right) => left.localeCompare(right),
      },
      taskTypes: {
        getAvailable: () => ['Feature'],
        isVisible: () => true,
      },
      scenarios: {
        getActiveId: () => 'baseline',
        list: () => [],
      },
      colors: {
        getProject: () => '#0f766e',
        getFeatureState: () => '#64748b',
        getFeatureStateColors: () => ({
          New: { background: '#64748b', text: '#ffffff' },
          Doing: { background: '#16a34a', text: '#ffffff' },
        }),
        getFeatureStateCategory: () => null,
      },
    };
  }

  async function mountPortfolio() {
    const element = await fixture(html`<plugin-portfolio-board></plugin-portfolio-board>`);
    element.api = api;
    element._refresh();
    await element.updateComplete;
    return element;
  }

  beforeEach(() => {
    features = [];
    updateFeature = sinon.stub().returns(true);
    api = createApi();
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
    features = [feature];

    const el = await mountPortfolio();
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

    expect(updateFeature.calledOnceWithExactly('F-1', 'state', 'Doing')).to.equal(true);
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
    features = [feature];
    updateFeature.returns(false);

    const el = await mountPortfolio();
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

    expect(updateFeature.calledOnceWithExactly('F-2', 'state', 'Doing')).to.equal(true);
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
    features = [feature];

    const el = await mountPortfolio();
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
    features = [feature];

    const el = await mountPortfolio();
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
    expect(updateFeature.called).to.equal(false);
    expect(el._dragState.active).to.equal(false);
  });

  it('builds a timeline extent from the visible task date range', async () => {
    const featureList = [
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
    features = featureList;

    const el = await mountPortfolio();
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
