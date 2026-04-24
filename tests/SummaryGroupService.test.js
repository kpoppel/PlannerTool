/**
 * Tests for SummaryGroupService - in-memory group store for plan summary mode.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock bus and EventRegistry before importing the service
vi.mock('../www/js/core/EventBus.js', () => ({
  bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('../www/js/core/EventRegistry.js', () => ({
  PlanSummaryEvents: {
    MODE_CHANGED: Symbol('planSummary:modeChanged'),
    GROUP_CREATED: Symbol('planSummary:groupCreated'),
    GROUP_UPDATED: Symbol('planSummary:groupUpdated'),
    GROUP_DISSOLVED: Symbol('planSummary:groupDissolved'),
    LAYOUT_UPDATED: Symbol('planSummary:layoutUpdated'),
  },
}));

// Import after mocks so the module picks up the mocked bus
const getService = async () => {
  const mod = await import('../www/js/services/SummaryGroupService.js');
  return mod.summaryGroupService;
};

describe('SummaryGroupService', () => {
  let svc;

  beforeEach(async () => {
    vi.resetModules();
    svc = await getService();
    // Clear all groups between tests
    svc.clearAll();
  });

  it('starts empty', () => {
    expect(svc.getGroups()).toEqual([]);
  });

  it('createGroup returns a group with correct shape', () => {
    const g = svc.createGroup(['f1', 'f2'], 'proj-a', 'My Group');
    expect(g.id).toBeTruthy();
    expect(g.title).toBe('My Group');
    expect(g.projectId).toBe('proj-a');
    expect(g.memberIds).toBeInstanceOf(Set);
    expect(g.memberIds.has('f1')).toBe(true);
    expect(g.memberIds.has('f2')).toBe(true);
    expect(g.collapsed).toBe(true); // groups are collapsed immediately on creation
  });

  it('createGroup assigns a default title when none provided', () => {
    const g = svc.createGroup(['f1'], 'proj-a');
    expect(g.title).toMatch(/^Group \d+$/);
  });

  it('getGroups filters by projectId', () => {
    svc.createGroup(['f1'], 'proj-a', 'A');
    svc.createGroup(['f2'], 'proj-b', 'B');
    expect(svc.getGroups('proj-a')).toHaveLength(1);
    expect(svc.getGroups('proj-b')).toHaveLength(1);
    expect(svc.getGroups()).toHaveLength(2);
  });

  it('getGroupForFeature returns correct group', () => {
    const g = svc.createGroup(['f1', 'f2'], 'proj-a');
    expect(svc.getGroupForFeature('f1')?.id).toBe(g.id);
    expect(svc.getGroupForFeature('f99')).toBeNull();
  });

  it('addMember adds a feature to an existing group', () => {
    const g = svc.createGroup(['f1'], 'proj-a');
    svc.addMember(g.id, 'f3');
    expect(g.memberIds.has('f3')).toBe(true);
  });

  it('addMember moves feature from another group', () => {
    const g1 = svc.createGroup(['f1', 'f2'], 'proj-a');
    const g2 = svc.createGroup(['f3'], 'proj-a');
    svc.addMember(g2.id, 'f1');
    expect(g2.memberIds.has('f1')).toBe(true);
    expect(g1.memberIds.has('f1')).toBe(false);
  });

  it('removeMember removes a feature from its group', () => {
    const g = svc.createGroup(['f1', 'f2'], 'proj-a');
    svc.removeMember('f1');
    expect(g.memberIds.has('f1')).toBe(false);
    expect(g.memberIds.has('f2')).toBe(true);
    expect(svc.getGroups()).toHaveLength(1);
  });

  it('removeMember dissolves a group when it becomes empty', () => {
    svc.createGroup(['f1'], 'proj-a');
    expect(svc.getGroups()).toHaveLength(1);
    svc.removeMember('f1');
    expect(svc.getGroups()).toHaveLength(0);
  });

  it('dissolveGroup removes the group entirely', () => {
    const g = svc.createGroup(['f1', 'f2'], 'proj-a');
    svc.dissolveGroup(g.id);
    expect(svc.getGroups()).toHaveLength(0);
    expect(svc.getGroupForFeature('f1')).toBeNull();
  });

  it('setTitle renames a group', () => {
    const g = svc.createGroup(['f1'], 'proj-a', 'Old');
    svc.setTitle(g.id, 'New Name');
    expect(g.title).toBe('New Name');
  });

  it('setCollapsed collapses a group', () => {
    const g = svc.createGroup(['f1'], 'proj-a');
    // Groups start collapsed; verify we can expand and re-collapse
    expect(g.collapsed).toBe(true);
    svc.setCollapsed(g.id, false);
    expect(g.collapsed).toBe(false);
    svc.setCollapsed(g.id, true);
    expect(g.collapsed).toBe(true);
  });

  it('createGroup moves a member already belonging to another group', () => {
    const g1 = svc.createGroup(['f1', 'f2'], 'proj-a');
    // f1 is in g1; creating a new group that includes f1 should move it
    const g2 = svc.createGroup(['f1', 'f3'], 'proj-a');
    expect(g2.memberIds.has('f1')).toBe(true);
    expect(g1.memberIds.has('f1')).toBe(false);
  });

  it('clearAll removes all groups', () => {
    svc.createGroup(['f1'], 'proj-a');
    svc.createGroup(['f2'], 'proj-b');
    svc.clearAll();
    expect(svc.getGroups()).toHaveLength(0);
  });
});
