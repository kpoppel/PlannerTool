/**
 * Tests for groupBandLayout.buildGroupBandItems using group.members
 * (replacing the old feature.groupId approach).
 *
 * The key behavioral change: which features appear inside a group band is
 * determined by group.members (a list of task IDs on the group object),
 * not by feature.groupId (a field on the feature that referenced a group).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub board-utils so we don't need canvas or DOM
vi.mock('../../www/js/components/board-utils.js', () => ({
  computePosition: vi.fn((item) => {
    if (!item.start || !item.end) return null;
    // Return a simple left/width based on arbitrary values for testing
    return { left: 10, width: 100 };
  }),
  laneHeight: vi.fn(() => 48),
}));

import { buildGroupBandItems } from '../../www/js/components/groupBandLayout.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const months = []; // not needed since computePosition is mocked

const mkFeature = (id, opts = {}) => ({
  id,
  start: opts.start || '2026-01-01',
  end: opts.end || '2026-03-01',
  ...opts,
});

const mkGroup = (id, planId, name, members = []) => ({
  id,
  plan_id: planId,
  name,
  members,
  rank: 0,
  color: '#4c8ef5',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildGroupBandItems — uses group.members for feature assignment', () => {
  it('assigns features to group based on group.members, not feature.groupId', () => {
    const f1 = mkFeature('task-1');
    const f2 = mkFeature('task-2');
    const group = mkGroup('g1', 'p1', 'Alpha', ['task-1']); // only task-1 in group

    const { items } = buildGroupBandItems(
      [f1, f2], [group], 0, months, false, false, new Set(), 'p1'
    );

    // Group pill should show featureCount=1 (only task-1 is a member)
    const groupItem = items.find((i) => i.isGroup && i.id === 'g1');
    expect(groupItem).toBeDefined();
    expect(groupItem.featureCount).toBe(1);

    // task-2 should appear in Ungrouped
    const ungroupedItem = items.find((i) => i.isGroup && String(i.id).startsWith('__ungrouped__'));
    expect(ungroupedItem).toBeDefined();
    expect(ungroupedItem.featureCount).toBe(1); // task-2
  });

  it('features without any group membership appear in Ungrouped', () => {
    const f1 = mkFeature('task-1');
    const group = mkGroup('g1', 'p1', 'Alpha', []); // empty members

    const { items } = buildGroupBandItems(
      [f1], [group], 0, months, false, false, new Set(), 'p1'
    );

    const ungroupedItem = items.find((i) => i.isGroup && String(i.id).startsWith('__ungrouped__'));
    expect(ungroupedItem.featureCount).toBe(1);

    const groupItem = items.find((i) => i.isGroup && i.id === 'g1');
    expect(groupItem.featureCount).toBe(0);
  });

  it('feature in group.members renders as child of that group', () => {
    const f1 = mkFeature('task-1');
    const group = mkGroup('g1', 'p1', 'Alpha', ['task-1']);

    const { items } = buildGroupBandItems(
      [f1], [group], 0, months, false, false, new Set(), 'p1'
    );

    // Feature card item should appear after the group item
    const groupIdx = items.findIndex((i) => i.isGroup && i.id === 'g1');
    const featureItem = items.find((i) => !i.isGroup && i.feature?.id === 'task-1');
    expect(featureItem).toBeDefined();
    // Feature card must come after the group pill
    expect(items.indexOf(featureItem)).toBeGreaterThan(groupIdx);
  });

  it('feature with old feature.groupId field is ignored — membership comes from group.members only', () => {
    // Old model: feature had groupId field pointing to a group.
    // New model: the feature.groupId field is irrelevant; only group.members matters.
    const f1 = mkFeature('task-1', { groupId: 'g1' }); // old field, should be ignored
    const group = mkGroup('g1', 'p1', 'Alpha', []); // group has no members

    const { items } = buildGroupBandItems(
      [f1], [group], 0, months, false, false, new Set(), 'p1'
    );

    // task-1 should be in Ungrouped because group.members is empty
    const ungroupedItem = items.find((i) => i.isGroup && String(i.id).startsWith('__ungrouped__'));
    expect(ungroupedItem.featureCount).toBe(1);

    const groupItem = items.find((i) => i.isGroup && i.id === 'g1');
    expect(groupItem.featureCount).toBe(0);
  });

  it('multiple groups correctly assign their respective members', () => {
    const f1 = mkFeature('task-1');
    const f2 = mkFeature('task-2');
    const f3 = mkFeature('task-3');
    const gA = mkGroup('gA', 'p1', 'Alpha', ['task-1', 'task-2']);
    const gB = mkGroup('gB', 'p1', 'Beta', ['task-3']);

    const { items } = buildGroupBandItems(
      [f1, f2, f3], [gA, gB], 0, months, false, false, new Set(), 'p1'
    );

    const gAItem = items.find((i) => i.isGroup && i.id === 'gA');
    const gBItem = items.find((i) => i.isGroup && i.id === 'gB');
    const ungroupedItem = items.find((i) => i.isGroup && String(i.id).startsWith('__ungrouped__'));

    expect(gAItem.featureCount).toBe(2);
    expect(gBItem.featureCount).toBe(1);
    expect(ungroupedItem.featureCount).toBe(0);
  });

  it('totalHeight grows with each group and its members', () => {
    const f1 = mkFeature('task-1');
    const f2 = mkFeature('task-2');
    const group = mkGroup('g1', 'p1', 'Alpha', ['task-1', 'task-2']);

    const { totalHeight } = buildGroupBandItems(
      [f1, f2], [group], 0, months, false, false, new Set(), 'p1'
    );

    // 28px for group pill + 2 * laneHeight(48) for features + 28px for ungrouped pill
    // = 28 + 96 + 28 = 152
    expect(totalHeight).toBe(28 + 48 * 2 + 28);
  });
});
