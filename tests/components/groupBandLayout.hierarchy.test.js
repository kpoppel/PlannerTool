import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { buildGroupBandItems } from '../../www/js/components/groupBandLayout.js';
import {
  buildHierarchyModel,
  createFeatureComparator,
} from '../../www/js/components/hierarchyFold.js';
import { sel } from '../../www/js/application/imports.js';

const MONTHS = [
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-02-01T00:00:00Z'),
  new Date('2026-03-01T00:00:00Z'),
  new Date('2026-04-01T00:00:00Z'),
  new Date('2026-05-01T00:00:00Z'),
  new Date('2026-06-01T00:00:00Z'),
];

const f = (id, parentId, start, end, rank) => ({
  id,
  parentId,
  project: 'p1',
  title: `T${id}`,
  start,
  end,
  originalRank: rank,
});

/**
 * epic          Feb 01 → Feb 10   rank 30
 *  ├── featA    Jan 05 → Jan 20   rank 20
 *  │    └── st  May 01 → May 20   rank 5
 *  └── featB    Mar 01 → Mar 10   rank 10
 * solo          Apr 01 → Apr 10   rank 40
 */
const features = [
  f('epic', null, '2026-02-01', '2026-02-10', 30),
  f('featA', 'epic', '2026-01-05', '2026-01-20', 20),
  f('featB', 'epic', '2026-03-01', '2026-03-10', 10),
  f('st', 'featA', '2026-05-01', '2026-05-20', 5),
  f('solo', null, '2026-04-01', '2026-04-10', 40),
];

const modelFor = (collapsed = new Set(), visible = features) =>
  buildHierarchyModel({
    allFeatures: features,
    visibleFeatures: visible,
    collapsed,
    sortSiblings: createFeatureComparator('rank'),
  });

const build = (visible, hierarchy) =>
  buildGroupBandItems(visible, [], 0, MONTHS, false, false, new Set(), hierarchy);

const cardIds = (result) =>
  result.items.filter((item) => !item.isGroup).map((item) => item.feature.id);

describe('buildGroupBandItems — hierarchy ordering', () => {
  beforeEach(() => {
    sinon
      .stub(sel.selection, 'getProjects')
      .returns([{ id: 'p1', name: 'Plan A', color: '#a00', selected: true }]);
    sinon.stub(sel.selection, 'getTeams').returns([]);
    sinon.stub(sel.view, 'getFeatureSortMode').returns('rank');
  });

  afterEach(() => sinon.restore());

  it('keeps the flat rank order when no hierarchy model is supplied', () => {
    expect(cardIds(build(features, null))).toEqual([
      'st',
      'featB',
      'featA',
      'epic',
      'solo',
    ]);
  });

  it('places descendants directly beneath their parent when a model is supplied', () => {
    expect(cardIds(build(features, modelFor()))).toEqual([
      'epic',
      'featB',
      'featA',
      'st',
      'solo',
    ]);
  });

  it('stamps the nesting depth on each card row', () => {
    const byId = new Map(
      build(features, modelFor())
        .items.filter((item) => !item.isGroup)
        .map((item) => [item.feature.id, item.hierarchyDepth])
    );
    expect(byId.get('epic')).toBe(0);
    expect(byId.get('featA')).toBe(1);
    expect(byId.get('st')).toBe(2);
    expect(byId.get('solo')).toBe(0);
  });

  it('marks rows that own visible descendants as foldable', () => {
    const byId = new Map(
      build(features, modelFor())
        .items.filter((item) => !item.isGroup)
        .map((item) => [item.feature.id, item.foldable])
    );
    expect(byId.get('epic')).toBe(true);
    expect(byId.get('featA')).toBe(true);
    expect(byId.get('featB')).toBe(false);
    expect(byId.get('solo')).toBe(false);
  });

  it('reports the total descendant count even when children are filtered out', () => {
    const visible = [features[0], features[1], features[3]];
    const row = build(visible, modelFor(new Set(), visible)).items.find(
      (item) => !item.isGroup && item.feature.id === 'epic'
    );
    expect(row.hiddenCount).toBe(3);
  });
});

describe('buildGroupBandItems — collapsed rows', () => {
  beforeEach(() => {
    sinon
      .stub(sel.selection, 'getProjects')
      .returns([{ id: 'p1', name: 'Plan A', color: '#a00', selected: true }]);
    sinon.stub(sel.selection, 'getTeams').returns([]);
    sinon.stub(sel.view, 'getFeatureSortMode').returns('rank');
  });

  afterEach(() => sinon.restore());

  it('flags the collapsed row so the card can render its folded state', () => {
    const row = build(features, modelFor(new Set(['featA']))).items.find(
      (item) => !item.isGroup && item.feature.id === 'featA'
    );
    expect(row.collapsed).toBe(true);
  });

  it('rolls a collapsed row up to the date span of its whole subtree', () => {
    const collapsed = build(features, modelFor(new Set(['featA']))).items.find(
      (item) => !item.isGroup && item.feature.id === 'featA'
    );
    const expanded = build(features, modelFor()).items.find(
      (item) => !item.isGroup && item.feature.id === 'featA'
    );
    // featA is Jan 05 → Jan 20 but its story runs to May 20.
    expect(collapsed.left).toBeCloseTo(expanded.left, 5);
    expect(collapsed.width).toBeGreaterThan(expanded.width);
  });

  it('leaves an expanded row on its own dates', () => {
    const row = build(features, modelFor()).items.find(
      (item) => !item.isGroup && item.feature.id === 'featA'
    );
    expect(row.collapsed).toBe(false);
  });

  it('passes the dated descendants through for the collapsed comb', () => {
    const row = build(features, modelFor(new Set(['epic']))).items.find(
      (item) => !item.isGroup && item.feature.id === 'epic'
    );
    expect(row.descendants.map((d) => d.id)).toEqual(['featA', 'featB', 'st']);
  });
});
