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

vi.mock('../../www/js/core/EventBus.js', () => ({
  bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../www/js/services/dataService.js', () => ({
  dataService: {
    listGroups: vi.fn(),
  },
}));

import { GroupService } from '../../www/js/services/GroupService.js';
import { bus } from '../../www/js/core/EventBus.js';
import { dataService } from '../../www/js/services/dataService.js';
import { GroupEvents, SessionEvents } from '../../www/js/core/EventRegistry.js';

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
    dataService.listGroups.mockReset();
    svc = new GroupService();
  });

  describe('hasPlanLoaded', () => {
    it('returns false before any load', () => {
      expect(svc.hasPlanLoaded('p1')).toBe(false);
    });

    it('returns true after batch loading (even when empty)', async () => {
      dataService.listGroups.mockResolvedValue([]);
      await svc.loadGroupsForPlans(['p1']);
      expect(svc.hasPlanLoaded('p1')).toBe(true);
    });

    it('returns false after evictPlan', async () => {
      dataService.listGroups.mockResolvedValue([mkGroup('g1', 'p1', 'A')]);
      await svc.loadGroupsForPlans(['p1']);
      svc.evictPlan('p1');
      expect(svc.hasPlanLoaded('p1')).toBe(false);
    });
  });

  // ---- Read ----------------------------------------------------------------

  describe('getGroupsForPlan', () => {
    it('returns empty array when no groups loaded', () => {
      expect(svc.getGroupsForPlan('plan-1')).toEqual([]);
    });

    it('returns cached groups after batch loading', async () => {
      const groups = [mkGroup('g1', 'plan-1', 'Alpha')];
      dataService.listGroups.mockResolvedValue(groups);
      await svc.loadGroupsForPlans(['plan-1']);
      expect(svc.getGroupsForPlan('plan-1')).toEqual(groups);
    });
  });

  describe('getGroupById', () => {
    it('finds a group by id across plans', async () => {
      const group = mkGroup('g1', 'p1', 'Alpha');
      dataService.listGroups.mockResolvedValue([group]);
      await svc.loadGroupsForPlans(['p1']);
      expect(svc.getGroupById('g1')).toMatchObject({ id: 'g1', name: 'Alpha' });
    });

    it('returns null for unknown id', () => {
      expect(svc.getGroupById('nonexistent')).toBeNull();
    });
  });

  // ---- Load ----------------------------------------------------------------

  it('exposes only the baseline cache and batch loading contract', async () => {
    for (const method of [
      'loadGroups', 'getAllGroups', 'hasAnyGroups', 'getEffectiveGroups',
      'createGroup', 'updateGroup', 'deleteGroup', 'addLocal', 'updateLocal',
      'removeLocal', 'clearTempGroups', 'replaceId',
    ]) {
      expect(method in svc).toBe(false);
    }
    dataService.listGroups.mockResolvedValue([]);
    await svc.loadGroupsForPlans(['p1']);
    expect(dataService.listGroups).toHaveBeenCalledExactlyOnceWith();
    expect(svc.hasPlanLoaded('p1')).toBe(true);
  });

  describe('loadGroupsForPlans', () => {
    it('batches missing plans, records empty plans, and preserves loaded edits', async () => {
      const local = mkGroup('tmp_local', 'loaded', 'Local');
      svc._groupsByPlan.set('loaded', [local]);
      dataService.listGroups.mockResolvedValue([
        mkGroup('g1', 'p1', 'A'), mkGroup('unselected', 'p3', 'C'),
      ]);
      bus.emit.mockClear();

      await svc.loadGroupsForPlans(['loaded', 'p1', 'p2']);

      expect(dataService.listGroups).toHaveBeenCalledExactlyOnceWith();
      expect(svc.getGroupsForPlan('loaded')).toEqual([local]);
      expect(svc.getGroupsForPlan('p1')).toHaveLength(1);
      expect(svc.hasPlanLoaded('p2')).toBe(true);
      expect(svc.hasPlanLoaded('p3')).toBe(false);
      expect(bus.emit).toHaveBeenCalledExactlyOnceWith(GroupEvents.LOADED);
      await svc.loadGroupsForPlans(['p1', 'p2']);
      expect(dataService.listGroups).toHaveBeenCalledTimes(1);
    });

    it('shares an in-flight batch across overlapping and newly requested plans', async () => {
      let resolve;
      dataService.listGroups.mockReturnValue(new Promise((done) => { resolve = done; }));
      const first = svc.loadGroupsForPlans(['p1']);
      const second = svc.loadGroupsForPlans(['p1', 'p2']);
      const single = svc.loadGroupsForPlans(['p1']);
      resolve([mkGroup('g2', 'p2', 'B')]);
      await Promise.all([first, second, single]);
      expect(dataService.listGroups).toHaveBeenCalledTimes(1);
      expect(svc.hasPlanLoaded('p1')).toBe(true);
      expect(svc.getGroupsForPlan('p2')).toHaveLength(1);
      expect(bus.emit).toHaveBeenCalledExactlyOnceWith(GroupEvents.LOADED);
    });

    it('discards evicted responses and allows a fresh publish reload', async () => {
      let resolve;
      dataService.listGroups.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
      const stale = svc.loadGroupsForPlans(['p1', 'p2']);
      svc.evictPlan('p1');
      dataService.listGroups.mockResolvedValueOnce([mkGroup('new', 'p1', 'New')]);
      await svc.loadGroupsForPlans(['p1']);
      resolve([mkGroup('old', 'p1', 'Old')]);
      await stale;
      expect(svc.getGroupsForPlan('p1').map((group) => group.id)).toEqual(['new']);
      expect(svc.hasPlanLoaded('p2')).toBe(true);
    });

    it('does not detach a batch when an unrelated plan is evicted', async () => {
      let resolve;
      dataService.listGroups.mockReturnValue(new Promise((done) => { resolve = done; }));
      const first = svc.loadGroupsForPlans(['p1']);
      svc.evictPlan('unselected');
      const second = svc.loadGroupsForPlans(['p2']);
      resolve([]);
      await Promise.all([first, second]);
      expect(dataService.listGroups).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite a local edit made during a fetch', async () => {
      let resolve;
      dataService.listGroups.mockReturnValue(new Promise((done) => { resolve = done; }));
      const pending = svc.loadGroupsForPlans(['p1']);
      const local = mkGroup('tmp_local', 'p1', 'Local');
      svc._groupsByPlan.set('p1', [local]);
      resolve([]);
      await pending;
      expect(svc.getGroupsForPlan('p1')).toEqual([local]);
    });

    it('rejects failures without marking plans loaded and permits retry', async () => {
      dataService.listGroups.mockRejectedValueOnce(new Error('network'));
      await expect(svc.loadGroupsForPlans(['p1'])).rejects.toThrow('network');
      expect(svc.hasPlanLoaded('p1')).toBe(false);
      dataService.listGroups.mockResolvedValueOnce([]);
      await svc.loadGroupsForPlans(['p1']);
      expect(svc.hasPlanLoaded('p1')).toBe(true);
    });

    it('keeps application instances independent and discards responses after account changes', async () => {
      const other = new GroupService();
      other._groupsByPlan.set('p1', [mkGroup('other-local', 'p1', 'Other')]);
      let resolve;
      dataService.listGroups.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
      const pending = svc.loadGroupsForPlans(['p1']);
      const reset = bus.on.mock.calls.find(([event]) => event === SessionEvents.CHANGED)[1];
      reset();
      resolve([mkGroup('old-user', 'p1', 'Old user')]);
      await pending;
      expect(svc.hasPlanLoaded('p1')).toBe(false);
      expect(other.getGroupsForPlan('p1')[0].id).toBe('other-local');
      dataService.listGroups.mockResolvedValueOnce([mkGroup('new-user', 'p1', 'New user')]);
      await svc.loadGroupsForPlans(['p1']);
      expect(svc.getGroupsForPlan('p1')[0].id).toBe('new-user');
    });
  });

  describe('batch responses', () => {
    it('fetches groups and caches them', async () => {
      const groups = [mkGroup('g1', 'p1', 'Alpha'), mkGroup('g2', 'p1', 'Beta')];
      dataService.listGroups.mockResolvedValue(groups);
      await svc.loadGroupsForPlans(['p1']);
      expect(dataService.listGroups).toHaveBeenCalledExactlyOnceWith();
      expect(svc.getGroupsForPlan('p1')).toEqual(groups);
    });

    it('rejects an invalid fetched value without marking the plan loaded', async () => {
      const groups = null;
      dataService.listGroups.mockResolvedValue(groups);

      await expect(svc.loadGroupsForPlans(['p1'])).rejects.toThrow(TypeError);
      expect(svc.hasPlanLoaded('p1')).toBe(false);
    });

    it('emits GroupEvents.LOADED after fetch', async () => {
      dataService.listGroups.mockResolvedValue([]);
      await svc.loadGroupsForPlans(['p1']);
      expect(bus.emit).toHaveBeenCalledWith(GroupEvents.LOADED);
    });

    it('rejects on error', async () => {
      dataService.listGroups.mockRejectedValue(new Error('network'));
      await expect(svc.loadGroupsForPlans(['p1'])).rejects.toThrow('network');
    });
  });

  describe('evictPlan', () => {
    it('removes cached groups for a plan', async () => {
      dataService.listGroups.mockResolvedValue([mkGroup('g1', 'p1', 'A')]);
      await svc.loadGroupsForPlans(['p1']);
      svc.evictPlan('p1');
      expect(svc.getGroupsForPlan('p1')).toEqual([]);
    });
  });

});
