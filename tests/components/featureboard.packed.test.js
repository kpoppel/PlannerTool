/**
 * Tests for FeatureBoard._packIntoRows and packed-mode duplicate prevention.
 *
 * Packed mode iterates sourceFeatures directly (unlike normal mode which uses
 * _orderFeaturesHierarchically with a visited-Set). When getEffectiveFeatures()
 * returns duplicate IDs (e.g. scenario overlay collisions), packed mode must
 * not render the same feature card twice.
 */
import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import { initTimeline, _resetTimelineState } from '../../www/js/components/Timeline.lit.js';
import { packIntoRows, buildGroupBandItems } from '../../www/js/components/groupBandLayout.js';
import '../../www/js/components/FeatureBoard.lit.js';
import { sel } from '../../www/js/application/imports.js';

describe('FeatureBoard._packIntoRows', () => {
  let el;

  before(async () => {
    await customElements.whenDefined('feature-board');
    el = await fixture(html`<feature-board></feature-board>`);
  });

  /** Build a minimal bar descriptor */
  function bar(left, width, id = String(left)) {
    return { left, width, feature: { id } };
  }

  it('returns an empty array for no bars', () => {
    const rows = packIntoRows([]);
    expect(rows).to.deep.equal([]);
  });

  it('places a single bar in its own row', () => {
    const rows = packIntoRows([bar(0, 100)]);
    expect(rows).to.have.length(1);
    expect(rows[0]).to.have.length(1);
  });

  it('non-overlapping bars (with gap) share a single row', () => {
    // bar1 ends at 100, bar2 starts at 110 (gap = 10 >= GAP=4)
    const rows = packIntoRows([bar(0, 100), bar(110, 100)]);
    expect(rows).to.have.length(1);
    expect(rows[0]).to.have.length(2);
  });

  it('overlapping bars go into separate rows', () => {
    // bar1: 0-100, bar2: 50-150 — clearly overlapping
    const rows = packIntoRows([bar(0, 100), bar(50, 100)]);
    expect(rows).to.have.length(2);
  });

  it('bars exactly at the gap boundary are packed into the same row', () => {
    // GAP = 4: bar1 ends at 100, bar2 starts at 104 (= 100 + 4) — just fits
    const rows = packIntoRows([bar(0, 100), bar(104, 50)]);
    expect(rows).to.have.length(1);
  });

  it('bars just inside the gap are placed in a new row', () => {
    // bar1 ends at 100, bar2 starts at 103 (= 100 + 3, not enough gap)
    const rows = packIntoRows([bar(0, 100), bar(103, 50)]);
    expect(rows).to.have.length(2);
  });

  it('three non-overlapping bars pack into one row', () => {
    const rows = packIntoRows([bar(0, 50), bar(60, 50), bar(120, 50)]);
    expect(rows).to.have.length(1);
    expect(rows[0]).to.have.length(3);
  });

  it('fills multiple rows greedily', () => {
    // All bars overlap each other
    const rows = packIntoRows([bar(0, 200), bar(10, 200), bar(20, 200)]);
    expect(rows).to.have.length(3);
    rows.forEach((row) => expect(row).to.have.length(1));
  });

  it('packs bars into the first available row (greedy strategy)', () => {
    // Row 0 has bar(0, 50). Row 1 has bar(10, 200). bar(60, 50) fits in row 0.
    const rows = packIntoRows([bar(0, 50), bar(10, 200), bar(60, 50)]);
    // bar(0,50) → row 0; bar(10,200) overlaps row 0 → row 1;
    // bar(60,50): row 0 ends at 50, 60 >= 50+4 → fits in row 0
    expect(rows).to.have.length(2);
    expect(rows[0]).to.have.length(2); // bar(0,50) and bar(60,50)
    expect(rows[1]).to.have.length(1); // bar(10,200)
  });

  it('preserves feature references in packed rows', () => {
    const f1 = { id: 'f1', title: 'Feature 1' };
    const f2 = { id: 'f2', title: 'Feature 2' };
    const bars = [
      { left: 0, width: 100, feature: f1 },
      { left: 200, width: 100, feature: f2 },
    ];
    const rows = packIntoRows(bars);
    expect(rows[0][0].feature).to.equal(f1);
    expect(rows[0][1].feature).to.equal(f2);
  });
});

// ---- Duplicate prevention in renderFeatures (packed mode) ----

describe('Group band ordering', () => {
  beforeEach(() => {
    sinon.stub(sel.selection, 'getProjects').returns([
      { id: 'p1', name: 'Plan A', color: '#aa0000', selected: true },
    ]);
    sinon.stub(sel.selection, 'getTeams').returns([]);
    sinon.stub(sel.view, 'getFeatureSortMode').returns('date');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('sorts task cards within a group by the active task sort mode without reordering groups', () => {
    const monthDates = [
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-02-01T00:00:00Z'),
      new Date('2025-03-01T00:00:00Z'),
      new Date('2025-04-01T00:00:00Z'),
      new Date('2025-05-01T00:00:00Z'),
      new Date('2025-06-01T00:00:00Z'),
    ];

    const features = [
      { id: 't2', title: 'Late task', start: '2025-03-10', end: '2025-03-20', project: 'p1', originalRank: 20 },
      { id: 't1', title: 'Early task', start: '2025-01-05', end: '2025-01-12', project: 'p1', originalRank: 5 },
      { id: 't3', title: 'Middle task', start: '2025-02-08', end: '2025-02-15', project: 'p1', originalRank: 10 },
      { id: 't4', title: 'Late group task', start: '2025-04-11', end: '2025-04-19', project: 'p1', originalRank: 30 },
    ];

    const groups = [
      { id: 'g2', plan_id: 'p1', name: 'Zeta', members: ['t4'], color: '#00ff00', rank: 20 },
      { id: 'g1', plan_id: 'p1', name: 'Alpha', members: ['t2', 't1', 't3'], color: '#ff0000', rank: 10 },
    ];

    const result = buildGroupBandItems(
      features,
      groups,
      0,
      monthDates,
      false,
      false,
      new Set(),
      'p1'
    );

    const groupOrder = result.items
      .filter((item) => item.isGroup && item.id !== '__ungrouped__:p1')
      .map((item) => item.id);
    const alphaCardIds = result.items
      .filter((item) => !item.isGroup && ['t2', 't1', 't3'].includes(item.feature.id))
      .map((item) => item.feature.id);

    expect(groupOrder).to.deep.equal(['g1', 'g2']);
    expect(alphaCardIds).to.deep.equal(['t1', 't3', 't2']);
  });

  it('tags each task card with the colour of the group that directly owns it', () => {
    const monthDates = [
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-02-01T00:00:00Z'),
      new Date('2025-03-01T00:00:00Z'),
    ];

    const features = [
      { id: 't1', title: 'In G1', start: '2025-01-05', end: '2025-01-12', project: 'p1', originalRank: 5 },
      { id: 't2', title: 'In G2', start: '2025-01-08', end: '2025-01-20', project: 'p1', originalRank: 10 },
      { id: 't4', title: 'Back in G1', start: '2025-02-01', end: '2025-02-10', project: 'p1', originalRank: 20 },
      { id: 't5', title: 'Ungrouped', start: '2025-02-12', end: '2025-02-20', project: 'p1', originalRank: 30 },
    ];

    // G1 : { t1, G2: { t2 }, t4 } — t4 must read as G1, not G2.
    const groups = [
      { id: 'g1', plan_id: 'p1', name: 'G1', members: ['t1', 't4'], color: '#ff0000', rank: 10 },
      { id: 'g2', plan_id: 'p1', name: 'G2', parent_id: 'g1', members: ['t2'], color: '#00ff00', rank: 15 },
    ];

    const result = buildGroupBandItems(
      features, groups, 0, monthDates, false, false, new Set(), 'p1'
    );

    const colourById = new Map(
      result.items
        .filter((item) => !item.isGroup)
        .map((item) => [item.feature.id, item.groupColor])
    );

    expect(colourById.get('t1')).to.equal('#ff0000');
    expect(colourById.get('t2')).to.equal('#00ff00');
    expect(colourById.get('t4')).to.equal('#ff0000');
    expect(colourById.get('t5')).to.equal(null);
  });
});

describe('FeatureBoard renderFeatures — no duplicate cards', () => {
  let board;
  let origComputePosition;
  let displayMode;
  let effectiveFeatures;
  let projects;

  beforeEach(async () => {
    _resetTimelineState();
    const timelineEl = document.createElement('timeline-lit');
    document.body.appendChild(timelineEl);
    await initTimeline();

    await customElements.whenDefined('feature-board');
    board = document.createElement('feature-board');
    document.body.appendChild(board);
    displayMode = 'normal';
    effectiveFeatures = [];
    projects = [{ id: 'p1', name: 'Plan A', color: '#aa0000', selected: true }];

    sinon.stub(sel.feature, 'getEffectiveFeatures').callsFake(() => effectiveFeatures);
    sinon.stub(sel.selection, 'getProjects').callsFake(() => projects);
    sinon.stub(sel.selection, 'getTeams').returns([]);
    sinon.stub(sel.selection, 'getSelectedProjectIds').callsFake(() =>
      projects.filter((p) => p.selected).map((p) => p.id)
    );
    sinon.stub(sel.selection, 'getSelectedTeamIds').returns([]);
    sinon.stub(sel.view, 'getPackedMode').callsFake(() => displayMode === 'packed');
    sinon.stub(sel.view, 'getCondensedCards').callsFake(() => displayMode !== 'normal');
    sinon.stub(sel.view, 'getFeatureSortMode').returns('rank');
    sinon.stub(sel.view, 'getExpansionState').returns({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    });
    sinon.stub(sel.view, 'getShowOnlyProjectHierarchy').returns(false);
    sinon.stub(sel.view, 'getShowUnplannedWork').returns(true);
    sinon.stub(sel.view, 'getShowUnassignedCards').returns(true);
    sinon.stub(sel.view, 'isTypeVisible').returns(true);
    sinon.stub(sel.filter, 'getSelectedFeatureStateSet').returns(new Set(['Active']));
    sinon.stub(sel.filter, 'featurePassesFilters').returns(true);
    sinon.stub(sel.group, 'getEffectiveGroups').returns([]);

    // Keep the test on the real board-utils behavior so it exercises the
    // actual packed-mode layout logic without mutating the imported module.
  });

  afterEach(() => {
    board.remove();
    sinon.restore();
  });

  /** Make a feature with dates so it survives the packed-mode position check */
  function makeFeature(id, title = `Feature ${id}`) {
    return {
      id,
      title,
      type: 'feature',
      start: '2025-01-01',
      end: '2025-06-30',
      project: 'p1',
      state: 'Active',
      capacity: [],
    };
  }

  it('packed mode: duplicate IDs in source features produce only one card per ID', async () => {
    const f = makeFeature('dup-1', 'Anti-Corruption');
    // Simulate getEffectiveFeatures returning the same feature twice (e.g. scenario overlay collision)
    effectiveFeatures = [f, { ...f }]; // same ID, two objects

    displayMode = 'packed';
    await board.renderFeatures();

    const ids = (board.features || []).map((item) => item.feature?.id);
    const uniqueIds = new Set(ids);
    expect(ids).to.have.length(
      uniqueIds.size,
      `Expected no duplicate feature IDs in render list, got: [${ids.join(', ')}]`
    );
    expect(uniqueIds.has('dup-1')).to.equal(true, 'The feature should still appear once');
  });

  it('packed mode: three features where one ID is repeated twice — renders each unique ID once', async () => {
    const f1 = makeFeature('f1', 'Alpha');
    const f2 = makeFeature('f2', 'Beta');
    // f1 appears a second time (simulates duplicate from data source)
    effectiveFeatures = [f1, f2, { ...f1 }];

    displayMode = 'packed';
    await board.renderFeatures();

    const ids = (board.features || []).map((item) => item.feature?.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).to.equal(
      uniqueIds.length,
      `Duplicate IDs found: [${ids.join(', ')}]`
    );
  });

  it('normal mode: duplicate IDs in source features produce only one card per ID', async () => {
    const f = makeFeature('dup-2', 'Anti-Corruption');
    effectiveFeatures = [f, { ...f }];

    displayMode = 'normal';
    await board.renderFeatures();

    const ids = (board.features || []).map((item) => item.feature?.id);
    const uniqueIds = new Set(ids);
    expect(ids).to.have.length(
      uniqueIds.size,
      `Expected no duplicate feature IDs in normal mode render list, got: [${ids.join(', ')}]`
    );
  });

  it('compact mode: duplicate IDs in source features produce only one card per ID', async () => {
    const f = makeFeature('dup-3', 'Anti-Corruption');
    effectiveFeatures = [f, { ...f }];

    displayMode = 'compact';
    await board.renderFeatures();

    const ids = (board.features || []).map((item) => item.feature?.id);
    const uniqueIds = new Set(ids);
    expect(ids).to.have.length(
      uniqueIds.size,
      `Expected no duplicate feature IDs in compact mode render list, got: [${ids.join(', ')}]`
    );
  });

  it('swimlane mode renders sticky label slots centered to the scroll viewport', async () => {
    const timelineBoard = document.querySelector('timeline-board') || document.body;
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'scroll-container';
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    timelineBoard.appendChild(scrollContainer);

    projects = [
      { id: 'p1', name: 'Plan A', color: '#aa0000', selected: true },
      { id: 'p2', name: 'Plan B', color: '#00aa00', selected: true },
    ];
    effectiveFeatures = [makeFeature('f1'), { ...makeFeature('f2'), project: 'p2' }];

    try {
      await board.renderFeatures();
      await board.updateComplete;

      expect(board.style.getPropertyValue('--swimlane-label-sticky-top')).to.equal('300px');

      const labelSlot = board.shadowRoot.querySelector('.swimlane-label-slot');
      const label = board.shadowRoot.querySelector('.swimlane-label');

      expect(labelSlot).to.exist;
      expect(label).to.exist;
      expect(label.className).to.contain('type-plan');
    } finally {
      scrollContainer.remove();
    }
  });
});

// ---- updateCardsById in packed mode triggers full rerender ----
describe('FeatureBoard updateCardsById — packed mode triggers full rerender', () => {
  let board;
  let origComputePosition;
  let displayMode;
  let effectiveFeatures;

  beforeEach(async () => {
    _resetTimelineState();
    const timelineEl = document.createElement('timeline-lit');
    document.body.appendChild(timelineEl);
    await initTimeline();

    await customElements.whenDefined('feature-board');
    board = document.createElement('feature-board');
    document.body.appendChild(board);
    displayMode = 'normal';
    effectiveFeatures = [];
    sinon.stub(sel.feature, 'getEffectiveFeatures').callsFake(() => effectiveFeatures);
    sinon.stub(sel.feature, 'getEffectiveFeatureById').callsFake((id) =>
      effectiveFeatures.find((f) => String(f.id) === String(id)) || null
    );
    sinon.stub(sel.selection, 'getProjects').returns([{ id: 'p1', selected: true }]);
    sinon.stub(sel.selection, 'getTeams').returns([]);
    sinon.stub(sel.selection, 'getSelectedProjectIds').returns(['p1']);
    sinon.stub(sel.selection, 'getSelectedTeamIds').returns([]);
    sinon.stub(sel.view, 'getPackedMode').callsFake(() => displayMode === 'packed');
    sinon.stub(sel.view, 'getCondensedCards').callsFake(() => displayMode !== 'normal');
    sinon.stub(sel.view, 'getFeatureSortMode').returns('rank');
    sinon.stub(sel.view, 'getExpansionState').returns({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    });
    sinon.stub(sel.view, 'getShowOnlyProjectHierarchy').returns(false);
    sinon.stub(sel.view, 'getShowUnplannedWork').returns(true);
    sinon.stub(sel.view, 'getShowUnassignedCards').returns(true);
    sinon.stub(sel.view, 'isTypeVisible').returns(true);
    sinon.stub(sel.filter, 'getSelectedFeatureStateSet').returns(new Set(['Active']));
    sinon.stub(sel.filter, 'featurePassesFilters').returns(true);
    sinon.stub(sel.group, 'getEffectiveGroups').returns([]);
  });

  afterEach(() => {
    board.remove();
    const timelineEl = document.querySelector('timeline-lit');
    if (timelineEl) timelineEl.remove();
    _resetTimelineState();
    sinon.restore();
  });

  function makeFeature(id, title = `Feature ${id}`) {
    return {
      id,
      title,
      type: 'feature',
      start: '2025-01-01',
      end: '2025-06-30',
      project: 'p1',
      state: 'Active',
      capacity: [],
    };
  }

  it('packed mode: updateCardsById triggers a full renderFeatures repack', async () => {
    const f1 = makeFeature('repack-1');
    const f2 = makeFeature('repack-2');
    effectiveFeatures = [f1, f2];

    displayMode = 'packed';

    let renderFeaturesCallCount = 0;
    const origRenderFeatures = board.renderFeatures.bind(board);
    board.renderFeatures = async () => {
      renderFeaturesCallCount++;
      return origRenderFeatures();
    };

    await board.updateCardsById(['repack-1']);

    expect(renderFeaturesCallCount).to.equal(
      1,
      'renderFeatures() must be called once when updateCardsById runs in packed mode'
    );
  });

  it('normal mode: updateCardsById does NOT call renderFeatures', async () => {
    displayMode = 'normal';

    let renderFeaturesCallCount = 0;
    board.renderFeatures = async () => {
      renderFeaturesCallCount++;
    };

    // Ensure _cardMap is empty so there is nothing to update (no crash path)
    await board.updateCardsById(['nonexistent-id']);

    expect(renderFeaturesCallCount).to.equal(
      0,
      'renderFeatures() must NOT be called from updateCardsById in normal mode'
    );
  });

  it('compact mode: updateCardsById does NOT call renderFeatures', async () => {
    displayMode = 'compact';

    let renderFeaturesCallCount = 0;
    board.renderFeatures = async () => {
      renderFeaturesCallCount++;
    };

    await board.updateCardsById(['nonexistent-id']);

    expect(renderFeaturesCallCount).to.equal(
      0,
      'renderFeatures() must NOT be called from updateCardsById in compact mode'
    );
  });
});
