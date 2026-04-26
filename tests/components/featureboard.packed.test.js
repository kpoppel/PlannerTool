/**
 * Tests for FeatureBoard._packIntoRows and packed-mode duplicate prevention.
 *
 * Packed mode iterates sourceFeatures directly (unlike normal mode which uses
 * _orderFeaturesHierarchically with a visited-Set). When getEffectiveFeatures()
 * returns duplicate IDs (e.g. scenario overlay collisions), packed mode must
 * not render the same feature card twice.
 */
import { fixture, html, expect } from '@open-wc/testing';
import * as boardUtils from '../../www/js/components/board-utils.js';
import '../../www/js/components/FeatureBoard.lit.js';
import { state } from '../../www/js/services/State.js';

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
    const rows = el._packIntoRows([]);
    expect(rows).to.deep.equal([]);
  });

  it('places a single bar in its own row', () => {
    const rows = el._packIntoRows([bar(0, 100)]);
    expect(rows).to.have.length(1);
    expect(rows[0]).to.have.length(1);
  });

  it('non-overlapping bars (with gap) share a single row', () => {
    // bar1 ends at 100, bar2 starts at 110 (gap = 10 >= GAP=4)
    const rows = el._packIntoRows([bar(0, 100), bar(110, 100)]);
    expect(rows).to.have.length(1);
    expect(rows[0]).to.have.length(2);
  });

  it('overlapping bars go into separate rows', () => {
    // bar1: 0-100, bar2: 50-150 — clearly overlapping
    const rows = el._packIntoRows([bar(0, 100), bar(50, 100)]);
    expect(rows).to.have.length(2);
  });

  it('bars exactly at the gap boundary are packed into the same row', () => {
    // GAP = 4: bar1 ends at 100, bar2 starts at 104 (= 100 + 4) — just fits
    const rows = el._packIntoRows([bar(0, 100), bar(104, 50)]);
    expect(rows).to.have.length(1);
  });

  it('bars just inside the gap are placed in a new row', () => {
    // bar1 ends at 100, bar2 starts at 103 (= 100 + 3, not enough gap)
    const rows = el._packIntoRows([bar(0, 100), bar(103, 50)]);
    expect(rows).to.have.length(2);
  });

  it('three non-overlapping bars pack into one row', () => {
    const rows = el._packIntoRows([bar(0, 50), bar(60, 50), bar(120, 50)]);
    expect(rows).to.have.length(1);
    expect(rows[0]).to.have.length(3);
  });

  it('fills multiple rows greedily', () => {
    // All bars overlap each other
    const rows = el._packIntoRows([bar(0, 200), bar(10, 200), bar(20, 200)]);
    expect(rows).to.have.length(3);
    rows.forEach((row) => expect(row).to.have.length(1));
  });

  it('packs bars into the first available row (greedy strategy)', () => {
    // Row 0 has bar(0, 50). Row 1 has bar(10, 200). bar(60, 50) fits in row 0.
    const rows = el._packIntoRows([bar(0, 50), bar(10, 200), bar(60, 50)]);
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
    const rows = el._packIntoRows(bars);
    expect(rows[0][0].feature).to.equal(f1);
    expect(rows[0][1].feature).to.equal(f2);
  });
});

// ---- Duplicate prevention in renderFeatures (packed mode) ----

describe('FeatureBoard renderFeatures — no duplicate cards', () => {
  let board;
  let origGetEffectiveFeatures;
  let origDisplayMode;
  let origComputePosition;

  beforeEach(async () => {
    await customElements.whenDefined('feature-board');
    board = document.createElement('feature-board');
    document.body.appendChild(board);
    origGetEffectiveFeatures = state.getEffectiveFeatures?.bind(state);
    origDisplayMode = state._viewService._displayMode;
    // Stub computePosition so tests don't depend on a real timeline being mounted.
    // Returns a deterministic fixed position for any feature that has dates.
    origComputePosition = boardUtils.computePosition;
    Object.defineProperty(boardUtils, 'computePosition', {
      configurable: true,
      writable: true,
      value: (feature) => {
        if (!feature.start || !feature.end) return null;
        return { left: 100, width: 200 };
      },
    });

    // Ensure project p1 is selected and passes filters
    state._projectTeamService.initFromBaseline([{ id: 'p1', selected: true }], []);
    state.setProjectSelected('p1', true);
    state._viewService.setShowOnlyProjectHierarchy(false);
    state._viewService.setShowUnplannedWork(true);
    state._viewService.setShowUnallocatedCards(true);
    // Allow 'Active' state through the filter (case-insensitive in _featurePassesFilters)
    state._stateFilterService._selectedFeatureStateFilter = new Set(['Active']);
  });

  afterEach(() => {
    board.remove();
    // Restore state
    state.getEffectiveFeatures = origGetEffectiveFeatures;
    state._viewService._displayMode = origDisplayMode;
    Object.defineProperty(boardUtils, 'computePosition', {
      configurable: true,
      writable: true,
      value: origComputePosition,
    });
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
    state.getEffectiveFeatures = () => [f, { ...f }]; // same ID, two objects

    state._viewService._displayMode = 'packed';
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
    state.getEffectiveFeatures = () => [f1, f2, { ...f1 }];

    state._viewService._displayMode = 'packed';
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
    state.getEffectiveFeatures = () => [f, { ...f }];

    state._viewService._displayMode = 'normal';
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
    state.getEffectiveFeatures = () => [f, { ...f }];

    state._viewService._displayMode = 'compact';
    await board.renderFeatures();

    const ids = (board.features || []).map((item) => item.feature?.id);
    const uniqueIds = new Set(ids);
    expect(ids).to.have.length(
      uniqueIds.size,
      `Expected no duplicate feature IDs in compact mode render list, got: [${ids.join(', ')}]`
    );
  });
});
