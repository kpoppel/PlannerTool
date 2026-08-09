import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateGroup,
  mockUpdateGroup,
  mockDeleteGroup,
  mockAddMember,
  mockRemoveMember,
  mockEffectiveGroups,
} = vi.hoisted(() => ({
  mockCreateGroup: vi.fn(),
  mockUpdateGroup: vi.fn(),
  mockDeleteGroup: vi.fn(),
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
    menu._config = { planId: 'p1' };
    menu._name = ' Group A ';
    menu._color = '#123';
    menu._parentId = null;
    menu._close = vi.fn();

    await menu._saveNewGroup();

    expect(mockCreateGroup).toHaveBeenCalledWith('p1', 'Group A', '#123', null);
    expect(menu._close).toHaveBeenCalledOnce();
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
});