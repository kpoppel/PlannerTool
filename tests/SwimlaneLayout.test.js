/**
 * Tests for SwimlaneLayout - layout engine for plan summary swimlane mode.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock board-utils to provide a predictable computePosition and laneHeight
vi.mock('../www/js/components/board-utils.js', () => ({
  computePosition: vi.fn((feature, _months) => {
    // Use a simple pixel = 10px per day offset from epoch for testing
    if (!feature.start || !feature.end) return null;
    const start = new Date(feature.start);
    const end = new Date(feature.end);
    const daysStart = Math.floor((start - new Date('2026-01-01')) / 86400000);
    const daysEnd = Math.floor((end - new Date('2026-01-01')) / 86400000);
    return { left: daysStart * 10, width: Math.max(8, (daysEnd - daysStart) * 10) };
  }),
  laneHeight: vi.fn(() => 28),
  findInBoard: vi.fn(() => null),
}));

const { buildSwimlaneLayout, flattenSwimlaneLayout } = await import(
  '../www/js/components/SwimlaneLayout.js'
);

/** Helper to make a minimal feature object */
function makeFeature(id, start, end, projectId) {
  return { id: String(id), start, end, project: String(projectId) };
}

/** Helper to make a minimal group object */
function makeGroup(id, memberIds, projectId, collapsed = false) {
  return {
    id: String(id),
    title: `Group ${id}`,
    projectId: String(projectId),
    memberIds: new Set(memberIds.map(String)),
    collapsed,
  };
}

/** Helper to make a project */
function makeProject(id, name, color = '#4a6fa5') {
  return { id: String(id), name, color, selected: true };
}

const MONTHS = [new Date('2026-01-01')];

describe('buildSwimlaneLayout', () => {
  it('returns empty swimlanes when no projects selected', () => {
    const result = buildSwimlaneLayout([], [], [], MONTHS);
    expect(result.swimlanes).toHaveLength(0);
    expect(result.totalHeight).toBe(0);
  });

  it('returns one swimlane per selected project', () => {
    const projects = [makeProject('p1', 'Alpha'), makeProject('p2', 'Beta')];
    const features = [
      makeFeature('f1', '2026-01-10', '2026-01-20', 'p1'),
      makeFeature('f2', '2026-01-05', '2026-01-15', 'p2'),
    ];
    const result = buildSwimlaneLayout(features, [], projects, MONTHS);
    expect(result.swimlanes).toHaveLength(2);
    expect(result.swimlanes[0].project.id).toBe('p1');
    expect(result.swimlanes[1].project.id).toBe('p2');
  });

  it('individual features appear as feature-type items', () => {
    const projects = [makeProject('p1', 'Alpha')];
    const features = [makeFeature('f1', '2026-01-10', '2026-01-20', 'p1')];
    const result = buildSwimlaneLayout(features, [], projects, MONTHS);
    const flat = flattenSwimlaneLayout(result, []);
    expect(flat).toHaveLength(1);
    expect(flat[0]._layoutType).toBe('feature');
    expect(flat[0].feature.id).toBe('f1');
  });

  it('non-overlapping features pack onto the same row', () => {
    const projects = [makeProject('p1', 'Alpha')];
    const features = [
      makeFeature('f1', '2026-01-01', '2026-01-10', 'p1'), // left=0 width=90
      makeFeature('f2', '2026-01-20', '2026-01-30', 'p1'), // left=190 — no overlap
    ];
    const result = buildSwimlaneLayout(features, [], projects, MONTHS);
    const flat = flattenSwimlaneLayout(result, []);
    expect(flat).toHaveLength(2);
    // Both should be on the same row (same top value)
    expect(flat[0].top).toBe(flat[1].top);
  });

  it('overlapping features go onto separate rows', () => {
    const projects = [makeProject('p1', 'Alpha')];
    const features = [
      makeFeature('f1', '2026-01-01', '2026-01-20', 'p1'),
      makeFeature('f2', '2026-01-05', '2026-01-25', 'p1'), // overlaps f1
    ];
    const result = buildSwimlaneLayout(features, [], projects, MONTHS);
    const flat = flattenSwimlaneLayout(result, []);
    expect(flat).toHaveLength(2);
    // Different rows => different top values
    expect(flat[0].top).not.toBe(flat[1].top);
  });

  it('group bar spans member date range', () => {
    const projects = [makeProject('p1', 'Alpha')];
    const features = [
      makeFeature('f1', '2026-01-01', '2026-01-10', 'p1'),
      makeFeature('f2', '2026-01-15', '2026-01-25', 'p1'),
    ];
    const group = makeGroup('g1', ['f1', 'f2'], 'p1');
    const result = buildSwimlaneLayout(features, [group], projects, MONTHS);
    const flat = flattenSwimlaneLayout(result, []);
    // Group bar should be present; individual bars should also be present (not collapsed)
    const groupItems = flat.filter((i) => i._layoutType === 'group');
    const featureItems = flat.filter((i) => i._layoutType === 'feature');
    expect(groupItems).toHaveLength(1);
    expect(featureItems).toHaveLength(2);
  });

  it('collapsed group hides member features', () => {
    const projects = [makeProject('p1', 'Alpha')];
    const features = [
      makeFeature('f1', '2026-01-01', '2026-01-10', 'p1'),
      makeFeature('f2', '2026-01-05', '2026-01-15', 'p1'),
    ];
    const group = makeGroup('g1', ['f1', 'f2'], 'p1', /* collapsed= */ true);
    const result = buildSwimlaneLayout(features, [group], projects, MONTHS);
    const flat = flattenSwimlaneLayout(result, []);
    const featureItems = flat.filter((i) => i._layoutType === 'feature');
    expect(featureItems).toHaveLength(0);
    const groupItems = flat.filter((i) => i._layoutType === 'group');
    expect(groupItems).toHaveLength(1);
  });

  it('swimlane heights accumulate for totalHeight', () => {
    const projects = [makeProject('p1', 'A'), makeProject('p2', 'B')];
    const features = [
      makeFeature('f1', '2026-01-01', '2026-01-10', 'p1'),
      makeFeature('f2', '2026-01-01', '2026-01-10', 'p2'),
    ];
    const result = buildSwimlaneLayout(features, [], projects, MONTHS);
    expect(result.totalHeight).toBeGreaterThan(0);
    const sumH = result.swimlanes.reduce((acc, s) => acc + s.totalHeight, 0);
    expect(result.totalHeight).toBe(sumH);
  });

  it('features without dates are skipped (no unplanned in summary mode)', () => {
    const projects = [makeProject('p1', 'Alpha')];
    const features = [
      makeFeature('f1', null, null, 'p1'),
      makeFeature('f2', '2026-01-01', '2026-01-10', 'p1'),
    ];
    const result = buildSwimlaneLayout(features, [], projects, MONTHS);
    const flat = flattenSwimlaneLayout(result, []);
    expect(flat).toHaveLength(1);
    expect(flat[0].feature.id).toBe('f2');
  });
});
