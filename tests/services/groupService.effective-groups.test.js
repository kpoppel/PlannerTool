/**
 * Tests for GroupService.getEffectiveGroups — merges baseline groups with
 * scenario-local groups and per-scenario member overrides.
 *
 * Design:
 *   getEffectiveGroups(planId, scenario)
 *     → baseline groups for planId, with scenario.overrides[groupId].members applied
 *     → plus scenario.scenarioGroups filtered to planId
 *
 * No DOM or Lit dependencies; runs cleanly in Vitest/jsdom.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../www/js/core/EventBus.js', () => ({
  bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../www/js/services/dataService.js', () => ({
  dataService: {
    listGroups: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
  },
}));

import { GroupService } from '../../www/js/services/GroupService.js';
import { dataService } from '../../www/js/services/dataService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mkGroup = (id, planId, name, extra = {}) => ({
  id, plan_id: planId, name, rank: 0, ...extra,
});

const mkScenario = (groupOverrides = {}, scenarioGroups = []) => ({
  id: 'scen-1',
  overrides: {},
  groupOverrides,
  scenarioGroups,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GroupService.getEffectiveGroups', () => {
  let svc;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new GroupService();
  });

  it('returns empty array when no baseline groups and no scenarioGroups', async () => {
    dataService.listGroups.mockResolvedValue([]);
    await svc.loadGroups('p1');
    const result = svc.getEffectiveGroups('p1', mkScenario());
    expect(result).toEqual([]);
  });

  it('returns baseline groups unchanged when scenario has no overrides', async () => {
    const g1 = mkGroup('g1', 'p1', 'Alpha', { members: ['t1'] });
    dataService.listGroups.mockResolvedValue([g1]);
    await svc.loadGroups('p1');
    const result = svc.getEffectiveGroups('p1', mkScenario());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'g1', members: ['t1'] });
  });

  it('applies scenario.overrides[groupId].memberDeltas to baseline group', async () => {
    const g1 = mkGroup('g1', 'p1', 'Alpha', { members: ['t1', 't2'] });
    dataService.listGroups.mockResolvedValue([g1]);
    await svc.loadGroups('p1');

    // Delta: remove t2, add t3
    const scenario = mkScenario({ 'g1': { memberDeltas: [{ taskId: 't2', op: 'remove' }, { taskId: 't3', op: 'add' }] } });
    const result = svc.getEffectiveGroups('p1', scenario);

    expect(result).toHaveLength(1);
    expect(result[0].members).toEqual(expect.arrayContaining(['t1', 't3']));
    expect(result[0].members).not.toContain('t2');
  });

  it('does not mutate the baseline group when applying member delta', async () => {
    const g1 = mkGroup('g1', 'p1', 'Alpha', { members: ['t1'] });
    dataService.listGroups.mockResolvedValue([g1]);
    await svc.loadGroups('p1');

    const scenario = mkScenario({ 'g1': { memberDeltas: [{ taskId: 't2', op: 'add' }] } });
    svc.getEffectiveGroups('p1', scenario);

    // Baseline cache should be unchanged
    expect(svc.getGroupsForPlan('p1')[0].members).toEqual(['t1']);
  });

  it('includes scenario.scenarioGroups for the correct planId', async () => {
    dataService.listGroups.mockResolvedValue([]);
    await svc.loadGroups('p1');

    const sg = mkGroup('tmp_123', 'p1', 'Local Group', { members: ['t5'] });
    const scenario = mkScenario({}, [sg]);
    const result = svc.getEffectiveGroups('p1', scenario);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'tmp_123', name: 'Local Group' });
  });

  it('filters scenarioGroups to the requested planId only', async () => {
    dataService.listGroups.mockResolvedValue([]);
    await svc.loadGroups('p1');

    const sgP1 = mkGroup('tmp_p1', 'p1', 'P1 Group');
    const sgP2 = mkGroup('tmp_p2', 'p2', 'P2 Group');
    const scenario = mkScenario({}, [sgP1, sgP2]);

    const result = svc.getEffectiveGroups('p1', scenario);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('tmp_p1');
  });

  it('returns baseline + scenarioGroups combined', async () => {
    const g1 = mkGroup('g1', 'p1', 'Baseline', { members: ['t1'] });
    dataService.listGroups.mockResolvedValue([g1]);
    await svc.loadGroups('p1');

    const sg = mkGroup('tmp_123', 'p1', 'Scenario Local');
    const scenario = mkScenario({}, [sg]);
    const result = svc.getEffectiveGroups('p1', scenario);

    expect(result).toHaveLength(2);
    const ids = result.map((g) => g.id);
    expect(ids).toContain('g1');
    expect(ids).toContain('tmp_123');
  });

  it('returns empty array when scenario is null', async () => {
    const g1 = mkGroup('g1', 'p1', 'Alpha');
    dataService.listGroups.mockResolvedValue([g1]);
    await svc.loadGroups('p1');
    const result = svc.getEffectiveGroups('p1', null);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g1');
  });

  it('leaves override fields on baseline group unchanged (only memberDeltas differ)', async () => {
    const g1 = mkGroup('g1', 'p1', 'Alpha', { members: ['t1'], color: '#ff0000', rank: 5 });
    dataService.listGroups.mockResolvedValue([g1]);
    await svc.loadGroups('p1');

    const scenario = mkScenario({ 'g1': { memberDeltas: [{ taskId: 't2', op: 'add' }] } });
    const result = svc.getEffectiveGroups('p1', scenario);

    expect(result[0].color).toBe('#ff0000');
    expect(result[0].rank).toBe(5);
    expect(result[0].name).toBe('Alpha');
  });
});

describe('GroupService.addMemberToGroup', () => {
  let svc;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new GroupService();
  });

  it('adds taskId to members of a scenario-local group', async () => {
    dataService.listGroups.mockResolvedValue([]);
    await svc.loadGroups('p1');

    const sg = mkGroup('tmp_123', 'p1', 'Local', { members: [] });
    // Simulate State holding scenario with scenarioGroups
    const scenario = { id: 'scen-1', overrides: {}, groupOverrides: {}, scenarioGroups: [sg] };
    const stateRef = {
      getActiveScenario: () => scenario,
      applyGroupMemberDelta: vi.fn(),
      markGroupChanged: vi.fn(),
    };

    svc.addMemberToGroup('tmp_123', 'task-99', stateRef);

    // The scenarioGroups entry should be updated
    expect(scenario.scenarioGroups[0].members).toContain('task-99');
  });

  it('does not add duplicate members', async () => {
    dataService.listGroups.mockResolvedValue([]);
    await svc.loadGroups('p1');

    const sg = mkGroup('tmp_123', 'p1', 'Local', { members: ['task-99'] });
    const scenario = { id: 'scen-1', overrides: {}, groupOverrides: {}, scenarioGroups: [sg] };
    const stateRef = { getActiveScenario: () => scenario };

    svc.addMemberToGroup('tmp_123', 'task-99', stateRef);

    expect(scenario.scenarioGroups[0].members).toHaveLength(1);
  });

  it('calls stateRef.applyGroupMemberDelta for baseline group', async () => {
    const g1 = mkGroup('g1', 'p1', 'Baseline', { members: ['t1'] });
    dataService.listGroups.mockResolvedValue([g1]);
    await svc.loadGroups('p1');

    const scenario = { id: 'scen-1', overrides: {}, groupOverrides: {}, scenarioGroups: [] };
    const stateRef = {
      getActiveScenario: () => scenario,
      applyGroupMemberDelta: vi.fn(),
    };

    svc.addMemberToGroup('g1', 'task-99', stateRef);

    expect(stateRef.applyGroupMemberDelta).toHaveBeenCalledWith('g1', 'task-99', 'add');
  });
});

describe('GroupService.removeMemberFromGroup', () => {
  let svc;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new GroupService();
  });

  it('removes taskId from members of a scenario-local group', async () => {
    dataService.listGroups.mockResolvedValue([]);
    await svc.loadGroups('p1');

    const sg = mkGroup('tmp_123', 'p1', 'Local', { members: ['task-1', 'task-2'] });
    const scenario = { id: 'scen-1', overrides: {}, groupOverrides: {}, scenarioGroups: [sg] };
    const stateRef = { getActiveScenario: () => scenario };

    svc.removeMemberFromGroup('tmp_123', 'task-1', stateRef);

    expect(scenario.scenarioGroups[0].members).toEqual(['task-2']);
  });

  it('calls stateRef.applyGroupMemberDelta for baseline group removal', async () => {
    const g1 = mkGroup('g1', 'p1', 'Baseline', { members: ['t1', 't2'] });
    dataService.listGroups.mockResolvedValue([g1]);
    await svc.loadGroups('p1');

    const scenario = { id: 'scen-1', overrides: {}, groupOverrides: {}, scenarioGroups: [] };
    const stateRef = {
      getActiveScenario: () => scenario,
      applyGroupMemberDelta: vi.fn(),
    };

    svc.removeMemberFromGroup('g1', 't1', stateRef);

    expect(stateRef.applyGroupMemberDelta).toHaveBeenCalledWith('g1', 't1', 'remove');
  });
});
