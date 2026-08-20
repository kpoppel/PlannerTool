import { describe, expect, it } from 'vitest';
import {
  resolveGroupDropSlot,
  resolveGroupMoveSlot,
  resolveInsertionSlot,
} from '../../www/js/components/groupBandLayout.js';
import { RANK_GAP } from '../../www/js/application/shared/ordering.js';

const PILL = 28;
const LANE = 40;

/** Group pill render item as produced by buildGroupBandItems. */
const pill = (id, top, rank, depth = 0, parentId = null) => ({
  isGroup: true,
  id,
  top,
  depth,
  name: id,
  groupObj: { id, plan_id: 'p1', name: id, parent_id: parentId },
  slotParentId: parentId,
  slotRank: rank,
});

/** Task card render item. */
const card = (id, top, rank, parentId = null) => ({
  top,
  feature: { id },
  slotParentId: parentId,
  slotRank: rank,
});

/**
 * A board with no groups at all — just root-level tasks.
 *   0   t1   rank 1024
 *   40  t2   rank 2048
 *   80  t3   rank 3072
 */
const flat = [card('t1', 0, 1024), card('t2', 40, 2048), card('t3', 80, 3072)];

/**
 * A board mixing groups and root tasks:
 *   0   t1              root, rank 1024
 *   40  [A]             root, rank 1536
 *   68    a1            in A, rank 2048
 *   108 [A1]            in A, rank 2560
 *   136     a2          in A1, rank 3072
 *   176 t2              root, rank 4096
 */
const mixed = [
  card('t1', 0, 1024),
  pill('A', 40, 1536),
  card('a1', 68, 2048, 'A'),
  pill('A1', 108, 2560, 1, 'A'),
  card('a2', 136, 3072, 'A1'),
  card('t2', 176, 4096),
];
const BOTTOM = 216;

describe('resolveInsertionSlot', () => {
  it('ranks the first group between the tasks the caret sits between', () => {
    const slot = resolveInsertionSlot(flat, 20, 120);
    expect(slot.parentId).toBeNull();
    expect(slot.caretTop).toBe(40);
    expect(slot.rank).toBe(1536);
    expect(slot.rankUpdates).toEqual([]);
    expect(slot.container).toBeNull();
  });

  it('ranks a group ahead of every task when the caret is at the very top', () => {
    const slot = resolveInsertionSlot(flat, -5, 120);
    expect(slot.caretTop).toBe(0);
    expect(slot.rank).toBe(512);
  });

  it('appends past the last task when the caret is below everything', () => {
    const slot = resolveInsertionSlot(flat, 200, 120);
    expect(slot.parentId).toBeNull();
    expect(slot.caretTop).toBe(120);
    expect(slot.rank).toBe(3072 + RANK_GAP);
  });

  it('reports no container when the board has no groups', () => {
    expect(resolveInsertionSlot(flat, 60, 120).container).toBeNull();
  });

  it('takes the sibling slot from the row below the cursor', () => {
    // Between t1 and the A pill, both root rows.
    const slot = resolveInsertionSlot(mixed, 20, BOTTOM);
    expect(slot.parentId).toBeNull();
    expect(slot.rank).toBe(1280);
    expect(slot.caretTop).toBe(40);
  });

  it('scopes the slot to the parent of the row below the cursor', () => {
    // Cursor on A's own task row: the next row is the A1 pill, a child of A.
    const slot = resolveInsertionSlot(mixed, 80, BOTTOM);
    expect(slot.parentId).toBe('A');
    expect(slot.rank).toBe(2304);
    expect(slot.caretTop).toBe(108);
    expect(slot.container.id).toBe('A');
  });

  it('offers the deepest band under the cursor as the sub-group container', () => {
    // Inside A1's rows the sibling slot is A1-scoped, and A1 is the container.
    const slot = resolveInsertionSlot(mixed, 150, BOTTOM);
    expect(slot.container).toEqual({ id: 'A1', name: 'A1', caretTop: 108 + PILL });
    expect(slot.parentId).toBeNull();
    expect(slot.caretTop).toBe(176);
  });

  it('ranks against root siblings only, skipping nested rows', () => {
    // The row below is the root task t2; its preceding root sibling is the A pill.
    const slot = resolveInsertionSlot(mixed, 150, BOTTOM);
    expect(slot.rank).toBe(Math.floor((1536 + 4096) / 2));
  });

  it('respaces siblings that share a rank so the new group still fits', () => {
    // Legacy groups persisted before ranks were meaningful all share rank 0.
    const legacy = [
      pill('A', 0, 0),
      pill('B', PILL, 0),
      pill('C', 2 * PILL, 0),
    ];
    const slot = resolveInsertionSlot(legacy, 20, 200);
    expect(slot.rankUpdates).toEqual([
      { id: 'A', rank: RANK_GAP },
      { id: 'B', rank: 2 * RANK_GAP },
      { id: 'C', rank: 3 * RANK_GAP },
    ]);
    expect(slot.rank).toBeGreaterThan(RANK_GAP);
    expect(slot.rank).toBeLessThan(2 * RANK_GAP);
  });

  it('returns a usable slot for a completely empty board', () => {
    const slot = resolveInsertionSlot([], 50, 300);
    expect(slot).toEqual({
      planId: null,
      parentId: null,
      rank: RANK_GAP,
      caretTop: 300,
      rankUpdates: [],
      container: null,
    });
  });

  it('carries the plan id so the menu can scope the new group', () => {
    expect(resolveInsertionSlot(mixed, 20, BOTTOM).planId).toBe('p1');
  });
});

describe('resolveGroupMoveSlot', () => {
  it('moves a group up relative to the previous task row', () => {
    // Stream: t1(1024), A(1536), ... -> move A up => before t1 (rank 512)
    const slot = resolveGroupMoveSlot(mixed, 'A', 'up');
    expect(slot).toEqual({
      parentId: null,
      rank: 512,
      rankUpdates: [],
    });
  });

  it('moves a group down relative to the next task row', () => {
    // Stream: t1(1024), A(1536), t2(4096) -> move A down => between t2 and tail
    const slot = resolveGroupMoveSlot(mixed, 'A', 'down');
    expect(slot.parentId).toBeNull();
    expect(slot.rank).toBeGreaterThan(4096);
    expect(slot.rankUpdates).toEqual([]);
  });

  it('returns null when moving above the first row or below the last row', () => {
    const noUp = resolveGroupMoveSlot(mixed, 'A', 'up');
    expect(noUp).not.toBeNull();

    const rootTail = [card('t1', 0, 1024), pill('A', 40, 2048)];
    expect(resolveGroupMoveSlot(rootTail, 'A', 'down')).toBeNull();
  });
});

describe('resolveGroupDropSlot', () => {
  it('excludes the dragged group and descendants when resolving drop placement', () => {
    // Dragging A out of its old subtree should still yield a root-level slot.
    const slot = resolveGroupDropSlot(mixed, 'A', 150, BOTTOM);
    expect(slot.parentId).toBeNull();
    expect(Number.isInteger(slot.rank)).toBe(true);
    expect(Number.isInteger(slot.caretTop)).toBe(true);
  });

  it('can place a dragged group between root task rows', () => {
    const slot = resolveGroupDropSlot(mixed, 'A1', 20, BOTTOM);
    expect(slot.parentId).toBeNull();
    expect(slot.rank).toBe(1280);
  });
});
