/**
 * Tests for GroupService — plan-scoped group management.
 * No DOM or Lit dependencies; runs cleanly in Vitest/jsdom.
 *
 * The dataService and bus modules are mocked so no network calls are made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must come before importing GroupService
// ---------------------------------------------------------------------------

vi.mock('../www/js/core/EventBus.js', () => ({
  bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../www/js/services/dataService.js', () => ({
  dataService: {
    listGroups: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
  },
}));

import { GroupService } from '../www/js/services/GroupService.js';
import { bus } from '../www/js/core/EventBus.js';
import { dataService } from '../www/js/services/dataService.js';
import { GroupEvents } from '../www/js/core/EventRegistry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mkGroup = (id, planId, name, color = '#4c8ef5', rank = 0) => ({
  id, plan_id: planId, name, color, rank,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GroupService', () => {
  let svc;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new GroupService();
  });

  describe('hasPlanLoaded', () => {
    it('returns false before any load', () => {
      expect(svc.hasPlanLoaded('p1')).toBe(false);
    });

    it('returns true after loadGroups (even when empty)', async () => {
      dataService.listGroups.mockResolvedValue([]);
      await svc.loadGroups('p1');
      expect(svc.hasPlanLoaded('p1')).toBe(true);
    });

    it('returns true after addLocal', () => {
      svc.addLocal('p1', mkGroup('g1', 'p1', 'A'));
      expect(svc.hasPlanLoaded('p1')).toBe(true);
    });

    it('returns false after evictPlan', async () => {
      dataService.listGroups.mockResolvedValue([mkGroup('g1', 'p1', 'A')]);
      await svc.loadGroups('p1');
      svc.evictPlan('p1');
      expect(svc.hasPlanLoaded('p1')).toBe(false);
    });
  });

  // ---- Read ----------------------------------------------------------------

  describe('getGroupsForPlan', () => {
    it('returns empty array when no groups loaded', () => {
      expect(svc.getGroupsForPlan('plan-1')).toEqual([]);
    });

    it('returns cached groups after loadGroups', async () => {
      const groups = [mkGroup('g1', 'plan-1', 'Alpha')];
      dataService.listGroups.mockResolvedValue(groups);
      await svc.loadGroups('plan-1');
      expect(svc.getGroupsForPlan('plan-1')).toEqual(groups);
    });
  });

  describe('getAllGroups', () => {
    it('returns groups from all loaded plans', async () => {
      dataService.listGroups.mockResolvedValueOnce([mkGroup('g1', 'p1', 'A')]);
      dataService.listGroups.mockResolvedValueOnce([mkGroup('g2', 'p2', 'B')]);
      await svc.loadGroups('p1');
      await svc.loadGroups('p2');
      expect(svc.getAllGroups()).toHaveLength(2);
    });
  });

  describe('hasAnyGroups', () => {
    it('returns false when no groups', () => {
      expect(svc.hasAnyGroups()).toBe(false);
    });

    it('returns true when groups exist for any plan', async () => {
      dataService.listGroups.mockResolvedValue([mkGroup('g1', 'p1', 'A')]);
      await svc.loadGroups('p1');
      expect(svc.hasAnyGroups()).toBe(true);
    });

    it('filters to specified planIds', async () => {
      dataService.listGroups.mockResolvedValueOnce([mkGroup('g1', 'p1', 'A')]);
      dataService.listGroups.mockResolvedValueOnce([]);
      await svc.loadGroups('p1');
      await svc.loadGroups('p2');
      expect(svc.hasAnyGroups(['p1'])).toBe(true);
      expect(svc.hasAnyGroups(['p2'])).toBe(false);
    });
  });

  describe('getGroupById', () => {
    it('finds a group by id across plans', async () => {
      const group = mkGroup('g1', 'p1', 'Alpha');
      dataService.listGroups.mockResolvedValue([group]);
      await svc.loadGroups('p1');
      expect(svc.getGroupById('g1')).toMatchObject({ id: 'g1', name: 'Alpha' });
    });

    it('returns null for unknown id', () => {
      expect(svc.getGroupById('nonexistent')).toBeNull();
    });
  });

  // ---- Load ----------------------------------------------------------------

  describe('loadGroups', () => {
    it('fetches groups and caches them', async () => {
      const groups = [mkGroup('g1', 'p1', 'Alpha'), mkGroup('g2', 'p1', 'Beta')];
      dataService.listGroups.mockResolvedValue(groups);
      const result = await svc.loadGroups('p1');
      expect(dataService.listGroups).toHaveBeenCalledWith('p1');
      expect(result).toEqual(groups);
      expect(svc.getGroupsForPlan('p1')).toEqual(groups);
    });

    it('emits GroupEvents.LOADED after fetch', async () => {
      dataService.listGroups.mockResolvedValue([]);
      await svc.loadGroups('p1');
      expect(bus.emit).toHaveBeenCalledWith(GroupEvents.LOADED, expect.objectContaining({ planId: 'p1' }));
    });

    it('returns empty array on error', async () => {
      dataService.listGroups.mockRejectedValue(new Error('network'));
      const result = await svc.loadGroups('p1');
      expect(result).toEqual([]);
    });
  });

  describe('evictPlan', () => {
    it('removes cached groups for a plan', async () => {
      dataService.listGroups.mockResolvedValue([mkGroup('g1', 'p1', 'A')]);
      await svc.loadGroups('p1');
      svc.evictPlan('p1');
      expect(svc.getGroupsForPlan('p1')).toEqual([]);
    });
  });

  // ---- Mutations -----------------------------------------------------------

  describe('createGroup', () => {
    it('creates a group and updates the cache', async () => {
      const created = mkGroup('g-server', 'p1', 'New Group');
      dataService.createGroup.mockResolvedValue(created);
      const result = await svc.createGroup('p1', 'New Group', { color: '#4c8ef5' });
      expect(result).toEqual(created);
      expect(svc.getGroupsForPlan('p1')).toContain(created);
    });

    it('emits GroupEvents.CHANGED with op=created', async () => {
      const created = mkGroup('g1', 'p1', 'A');
      dataService.createGroup.mockResolvedValue(created);
      await svc.createGroup('p1', 'A');
      expect(bus.emit).toHaveBeenCalledWith(
        GroupEvents.CHANGED,
        expect.objectContaining({ op: 'created', group: created })
      );
    });

    it('returns null when server returns null', async () => {
      dataService.createGroup.mockResolvedValue(null);
      const result = await svc.createGroup('p1', 'A');
      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      dataService.createGroup.mockRejectedValue(new Error('fail'));
      const result = await svc.createGroup('p1', 'A');
      expect(result).toBeNull();
    });
  });

  describe('updateGroup', () => {
    it('updates a group in the cache', async () => {
      const original = mkGroup('g1', 'p1', 'Old Name');
      const updated = { ...original, name: 'New Name' };
      dataService.listGroups.mockResolvedValue([original]);
      await svc.loadGroups('p1');
      dataService.updateGroup.mockResolvedValue(updated);
      const result = await svc.updateGroup('g1', { name: 'New Name' });
      expect(result).toEqual(updated);
      expect(svc.getGroupsForPlan('p1')[0].name).toBe('New Name');
    });

    it('emits GroupEvents.CHANGED with op=updated', async () => {
      const original = mkGroup('g1', 'p1', 'A');
      const updated = { ...original, name: 'B' };
      dataService.listGroups.mockResolvedValue([original]);
      await svc.loadGroups('p1');
      dataService.updateGroup.mockResolvedValue(updated);
      await svc.updateGroup('g1', { name: 'B' });
      expect(bus.emit).toHaveBeenCalledWith(
        GroupEvents.CHANGED,
        expect.objectContaining({ op: 'updated' })
      );
    });

    it('returns null on server error', async () => {
      dataService.updateGroup.mockRejectedValue(new Error('fail'));
      const result = await svc.updateGroup('g1', { name: 'X' });
      expect(result).toBeNull();
    });
  });

  describe('deleteGroup', () => {
    it('removes a group from the cache', async () => {
      const group = mkGroup('g1', 'p1', 'A');
      dataService.listGroups.mockResolvedValue([group]);
      await svc.loadGroups('p1');
      dataService.deleteGroup.mockResolvedValue(true);
      const ok = await svc.deleteGroup('g1');
      expect(ok).toBe(true);
      expect(svc.getGroupsForPlan('p1')).toHaveLength(0);
    });

    it('emits GroupEvents.CHANGED with op=deleted', async () => {
      const group = mkGroup('g1', 'p1', 'A');
      dataService.listGroups.mockResolvedValue([group]);
      await svc.loadGroups('p1');
      dataService.deleteGroup.mockResolvedValue(true);
      await svc.deleteGroup('g1');
      expect(bus.emit).toHaveBeenCalledWith(
        GroupEvents.CHANGED,
        expect.objectContaining({ op: 'deleted', groupId: 'g1' })
      );
    });

    it('returns false when server returns false', async () => {
      dataService.deleteGroup.mockResolvedValue(false);
      const ok = await svc.deleteGroup('g1');
      expect(ok).toBe(false);
    });

    it('returns false on error', async () => {
      dataService.deleteGroup.mockRejectedValue(new Error('fail'));
      const ok = await svc.deleteGroup('g1');
      expect(ok).toBe(false);
    });
  });

  // ---- Sub-groups (parent_id) ---------------------------------------------

  describe('sub-groups via addLocal', () => {
    it('addLocal stores a sub-group with parent_id', () => {
      const parent = mkGroup('g-parent', 'p1', 'Parent');
      const child  = { ...mkGroup('g-child', 'p1', 'Child'), parent_id: 'g-parent' };
      svc.addLocal('p1', parent);
      svc.addLocal('p1', child);
      const groups = svc.getGroupsForPlan('p1');
      expect(groups).toHaveLength(2);
      const childGroup = groups.find((g) => g.id === 'g-child');
      expect(childGroup).toBeDefined();
      expect(childGroup.parent_id).toBe('g-parent');
    });

    it('getGroupById finds a sub-group by id', () => {
      const child = { ...mkGroup('g-child', 'p1', 'Child'), parent_id: 'g-parent' };
      svc.addLocal('p1', child);
      expect(svc.getGroupById('g-child')).toMatchObject({ id: 'g-child', parent_id: 'g-parent' });
    });

    it('removeLocal removes a group and its sub-groups', () => {
      const parent = mkGroup('g-parent', 'p1', 'Parent');
      const child  = { ...mkGroup('g-child', 'p1', 'Child'), parent_id: 'g-parent' };
      svc.addLocal('p1', parent);
      svc.addLocal('p1', child);
      svc.removeLocal('g-parent');
      // Both parent and child should be gone
      expect(svc.getGroupsForPlan('p1')).toHaveLength(0);
    });

    it('deleteGroup (server) cascades removal of sub-groups from cache', async () => {
      const parent = mkGroup('g-parent', 'p1', 'Parent');
      const child  = { ...mkGroup('g-child', 'p1', 'Child'), parent_id: 'g-parent' };
      dataService.listGroups.mockResolvedValue([parent, child]);
      await svc.loadGroups('p1');
      dataService.deleteGroup.mockResolvedValue(true);
      await svc.deleteGroup('g-parent');
      expect(svc.getGroupsForPlan('p1')).toHaveLength(0);
    });
  });

  // ---- Group tree topology helpers ----------------------------------------

  describe('group tree topology', () => {
    /**
     * Local helper: given a flat array of groups, build the parent→children
     * map the same way FeatureBoard does.
     */
    const buildChildMap = (groups) => {
      const ids = new Set(groups.map((g) => String(g.id)));
      const map = new Map();
      for (const g of groups) {
        if (g.parent_id && ids.has(String(g.parent_id))) {
          const key = String(g.parent_id);
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(g);
        }
      }
      return map;
    };

    it('top-level groups have no parent_id (or orphan parent)', () => {
      const groups = [
        mkGroup('g1', 'p1', 'Root'),
        { ...mkGroup('g2', 'p1', 'Child'), parent_id: 'g1' },
        { ...mkGroup('g3', 'p1', 'OrphanChild'), parent_id: 'nonexistent' },
      ];
      const ids = new Set(groups.map((g) => String(g.id)));
      const topLevel = groups.filter((g) => !g.parent_id || !ids.has(String(g.parent_id)));
      expect(topLevel.map((g) => g.id)).toEqual(expect.arrayContaining(['g1', 'g3']));
      expect(topLevel.map((g) => g.id)).not.toContain('g2');
    });

    it('buildChildMap correctly maps parent to direct children only', () => {
      const groups = [
        mkGroup('g1', 'p1', 'Root'),
        { ...mkGroup('g2', 'p1', 'Child'), parent_id: 'g1' },
        { ...mkGroup('g3', 'p1', 'Grandchild'), parent_id: 'g2' },
      ];
      const map = buildChildMap(groups);
      expect(map.get('g1')).toHaveLength(1);
      expect(map.get('g1')[0].id).toBe('g2');
      expect(map.get('g2')).toHaveLength(1);
      expect(map.get('g2')[0].id).toBe('g3');
      expect(map.has('g3')).toBe(false);
    });

    it('handles groups with no children gracefully', () => {
      const groups = [mkGroup('g1', 'p1', 'Leaf')];
      const map = buildChildMap(groups);
      expect(map.size).toBe(0);
    });
  });
});
