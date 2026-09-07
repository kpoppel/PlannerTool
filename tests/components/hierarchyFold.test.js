import { describe, it, expect } from 'vitest';
import {
  buildHierarchyModel,
  collapseToDepth,
  createFeatureComparator,
  foldDepthOptions,
  resolveParentId,
} from '../../www/js/components/hierarchyFold.js';

const f = (id, parentId, extra = {}) => ({
  id,
  parentId,
  title: `T${id}`,
  start: '2026-01-01',
  end: '2026-01-31',
  originalRank: Number(id),
  ...extra,
});

/**
 *  1
 *  ├── 2
 *  │   └── 4
 *  └── 3
 *  5 (root, no children)
 */
const tree = [
  f('1', null),
  f('2', '1'),
  f('3', '1'),
  f('4', '2'),
  f('5', null),
];

const model = (overrides = {}) =>
  buildHierarchyModel({
    allFeatures: tree,
    visibleFeatures: tree,
    collapsed: new Set(),
    sortSiblings: createFeatureComparator('rank'),
    ...overrides,
  });

describe('resolveParentId', () => {
  it('reads parentId when present', () => {
    expect(resolveParentId({ id: 'a', parentId: 'p' })).toBe('p');
  });

  it('falls back to a Parent relation when parentId is absent', () => {
    const feature = { id: 'a', relations: [{ type: 'Parent', id: 'p' }] };
    expect(resolveParentId(feature)).toBe('p');
  });

  it('returns null for a root task', () => {
    expect(resolveParentId({ id: 'a', relations: [{ type: 'Related', id: 'x' }] })).toBe(
      null
    );
  });
});

describe('buildHierarchyModel — depth and order', () => {
  it('assigns depth by distance from the root', () => {
    const m = model();
    expect(m.depth.get('1')).toBe(0);
    expect(m.depth.get('2')).toBe(1);
    expect(m.depth.get('4')).toBe(2);
    expect(m.depth.get('5')).toBe(0);
  });

  it('reports the deepest level in the dataset', () => {
    expect(model().maxDepth).toBe(2);
  });

  it('orders depth-first so descendants immediately follow their parent', () => {
    const m = model();
    const ordered = [...m.order.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);
    expect(ordered).toEqual(['1', '2', '4', '3', '5']);
  });

  it('sorts siblings with the supplied comparator', () => {
    const dated = [
      f('1', null, { start: '2026-03-01' }),
      f('2', null, { start: '2026-01-01' }),
    ];
    const byDate = buildHierarchyModel({
      allFeatures: dated,
      visibleFeatures: dated,
      collapsed: new Set(),
      sortSiblings: createFeatureComparator('date'),
    });
    expect(byDate.order.get('2')).toBeLessThan(byDate.order.get('1'));
  });

  it('treats a task whose parent is outside the visible set as a root', () => {
    const orphan = [f('4', '2')];
    const m = buildHierarchyModel({
      allFeatures: orphan,
      visibleFeatures: orphan,
      collapsed: new Set(),
      sortSiblings: createFeatureComparator('rank'),
    });
    expect(m.depth.get('4')).toBe(0);
  });

  it('does not loop forever on a parent cycle', () => {
    const cyclic = [f('a', 'b'), f('b', 'a')];
    const m = buildHierarchyModel({
      allFeatures: cyclic,
      visibleFeatures: cyclic,
      collapsed: new Set(),
      sortSiblings: createFeatureComparator('rank'),
    });
    expect(m.order.size).toBe(2);
  });
});

describe('buildHierarchyModel — folding', () => {
  it('hides every descendant of a collapsed task', () => {
    const m = model({ collapsed: new Set(['1']) });
    expect([...m.hidden].sort()).toEqual(['2', '3', '4']);
  });

  it('hides nested descendants when only the inner task is collapsed', () => {
    const m = model({ collapsed: new Set(['2']) });
    expect([...m.hidden]).toEqual(['4']);
  });

  it('leaves nothing hidden when no task is collapsed', () => {
    expect(model().hidden.size).toBe(0);
  });
});

describe('buildHierarchyModel — descendant counts', () => {
  it('counts all descendants regardless of filtering', () => {
    const m = model({ visibleFeatures: [tree[0]] });
    expect(m.descendantCount.get('1')).toBe(3);
    expect(m.descendantCount.get('2')).toBe(1);
    expect(m.descendantCount.get('5')).toBe(0);
  });

  it('counts visible descendants separately from the total', () => {
    const m = model({ visibleFeatures: [tree[0], tree[1]] });
    expect(m.descendantCount.get('1')).toBe(3);
    expect(m.visibleDescendantCount.get('1')).toBe(1);
  });
});

describe('buildHierarchyModel — subtree extent', () => {
  it('spans the earliest start and latest end across the whole subtree', () => {
    const spread = [
      f('1', null, { start: '2026-05-01', end: '2026-05-10' }),
      f('2', '1', { start: '2026-01-05', end: '2026-02-01' }),
      f('3', '1', { start: '2026-07-01', end: '2026-09-30' }),
    ];
    const m = buildHierarchyModel({
      allFeatures: spread,
      visibleFeatures: spread,
      collapsed: new Set(),
      sortSiblings: createFeatureComparator('rank'),
    });
    expect(m.extent.get('1')).toEqual({ start: '2026-01-05', end: '2026-09-30' });
  });

  it('ignores descendants without dates', () => {
    const partial = [
      f('1', null, { start: '2026-05-01', end: '2026-05-10' }),
      f('2', '1', { start: null, end: null }),
    ];
    const m = buildHierarchyModel({
      allFeatures: partial,
      visibleFeatures: partial,
      collapsed: new Set(),
      sortSiblings: createFeatureComparator('rank'),
    });
    expect(m.extent.get('1')).toEqual({ start: '2026-05-01', end: '2026-05-10' });
  });

  it('returns descendant ids in date order for the collapsed comb', () => {
    const spread = [
      f('1', null, { start: '2026-05-01', end: '2026-05-10' }),
      f('2', '1', { start: '2026-07-01', end: '2026-07-10' }),
      f('3', '1', { start: '2026-01-05', end: '2026-02-01' }),
    ];
    const m = buildHierarchyModel({
      allFeatures: spread,
      visibleFeatures: spread,
      collapsed: new Set(),
      sortSiblings: createFeatureComparator('rank'),
    });
    expect(m.descendants.get('1').map((d) => d.id)).toEqual(['3', '2']);
  });
});

describe('foldDepthOptions', () => {
  it('offers nothing when no task is nested', () => {
    expect(foldDepthOptions(0)).toEqual([]);
  });

  it('offers one button per level plus All', () => {
    expect(foldDepthOptions(2)).toEqual([
      { label: '1', depth: 1 },
      { label: '2', depth: 2 },
      { label: 'All', depth: 3 },
    ]);
  });

  it('grows with the depth of the dataset', () => {
    expect(foldDepthOptions(4).map((o) => o.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
      'All',
    ]);
  });

  it('leaves the tree fully expanded at the All depth', () => {
    const m = model();
    const options = foldDepthOptions(m.maxDepth);
    const all = options[options.length - 1].depth;
    expect([...collapseToDepth(m, all)]).toEqual([]);
  });
});

describe('collapseToDepth', () => {
  it('collapses the parents needed to leave only the requested number of levels', () => {
    const m = model();
    // depth 1 => only root rows remain, so every parent must be collapsed
    expect([...collapseToDepth(m, 1)].sort()).toEqual(['1', '2']);
    // depth 2 => roots and their children remain, so only the depth-1 parent folds
    expect([...collapseToDepth(m, 2)].sort()).toEqual(['2']);
  });

  it('collapses nothing once the depth covers the whole tree', () => {
    const m = model();
    expect(m.maxDepth).toBe(2);
    expect([...collapseToDepth(m, 3)]).toEqual([]);
  });

  it('never collapses a childless task', () => {
    const m = model();
    expect(collapseToDepth(m, 1).has('5')).toBe(false);
  });
});
