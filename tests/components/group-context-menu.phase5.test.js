import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateGroup,
  mockUpdateGroup,
  mockDeleteGroup,
  mockMoveGroup,
  mockAddMember,
  mockRemoveMember,
  mockEffectiveGroups,
} = vi.hoisted(() => ({
  mockCreateGroup: vi.fn(),
  mockUpdateGroup: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockMoveGroup: vi.fn(),
  mockAddMember: vi.fn(),
  mockRemoveMember: vi.fn(),
  mockEffectiveGroups: vi.fn(() => []),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    group: {
      createGroupInScenario: mockCreateGroup,
      updateGroupInScenario: mockUpdateGroup,
      deleteGroupInScenario: mockDeleteGroup,
      moveGroupInScenario: mockMoveGroup,
      addMemberToGroup: mockAddMember,
      removeMemberFromGroup: mockRemoveMember,
    },
  },
  sel: {
    group: {
      getEffectiveGroups: mockEffectiveGroups,
    },
  },
}));

import { GroupContextMenu } from '../../www/js/components/GroupContextMenu.lit.js';

describe('GroupContextMenu phase 5 seam migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a group via cmd.group.createGroupInScenario', async () => {
    const menu = new GroupContextMenu();
    menu._config = { type: 'board', planId: 'p1' };
    menu._name = ' Group A ';
    menu._color = '#123';
    menu._createSlot = { parentId: null, rank: 1536, rankUpdates: [] };
    menu._close = vi.fn();

    await menu._saveNewGroup();

    expect(mockCreateGroup).toHaveBeenCalledWith('p1', 'Group A', '#123', null, 1536, []);
    expect(menu._close).toHaveBeenCalledOnce();
  });

  it('creates a sub-group as the first child of the right-clicked group', async () => {
    const menu = new GroupContextMenu();
    menu._config = { type: 'group', group: { id: 'g1', plan_id: 'p1', name: 'G1' } };
    menu._name = 'Child';
    menu._color = '#123';
    menu._createSlot = menu._subGroupSlot('g1');
    menu._close = vi.fn();

    await menu._saveNewGroup();

    expect(mockCreateGroup).toHaveBeenCalledWith('p1', 'Child', '#123', 'g1', 1024, []);
  });

  it('reassigns feature membership via sel.group + cmd.group calls', () => {
    mockEffectiveGroups.mockReturnValue([
      { id: 'g1', members: ['f1'] },
      { id: 'g2', members: [] },
    ]);

    const menu = new GroupContextMenu();
    menu._config = { feature: { id: 'f1', project: 'p1' } };
    menu._close = vi.fn();

    menu._assignToGroup('g2');

    expect(mockEffectiveGroups).toHaveBeenCalledWith('p1');
    expect(mockRemoveMember).toHaveBeenCalledWith('g1', 'f1');
    expect(mockAddMember).toHaveBeenCalledWith('g2', 'f1');
  });

  it('moves a group via cmd.group.moveGroupInScenario', () => {
    const menu = new GroupContextMenu();
    menu._config = { group: { id: 'g2' } };
    menu._resolveMoveSlot = vi.fn(() => ({ parentId: null, rank: 1536, rankUpdates: [] }));
    menu._close = vi.fn();

    menu._moveGroupByDirection('up');

    expect(mockMoveGroup).toHaveBeenCalledWith('g2', {
      parentId: null,
      rank: 1536,
      rankUpdates: [],
    });
    expect(menu._close).toHaveBeenCalledOnce();
  });
});