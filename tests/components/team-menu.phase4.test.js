import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelectionCommands = vi.hoisted(() => ({
  setTeamSelected: vi.fn(),
  setTeamsSelectedBulk: vi.fn(),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    selection: mockSelectionCommands,
  },
  sel: {},
}));

import { TeamMenuLit } from '../../www/js/components/TeamMenu.lit.js';

describe('TeamMenu Phase 4 command seam', () => {
  beforeEach(() => {
    mockSelectionCommands.setTeamSelected.mockReset();
    mockSelectionCommands.setTeamsSelectedBulk.mockReset();
  });

  it('routes single toggle through cmd.selection.setTeamSelected', () => {
    const el = new TeamMenuLit();
    el.teams = [{ id: 't1', selected: false }];

    el._toggleTeam('t1');

    expect(mockSelectionCommands.setTeamSelected).toHaveBeenCalledWith('t1', true);
  });

  it('routes bulk toggle through cmd.selection.setTeamsSelectedBulk', () => {
    const el = new TeamMenuLit();
    el.teams = [
      { id: 't1', selected: true },
      { id: 't2', selected: false },
    ];

    el._handleTeamToggle();

    expect(mockSelectionCommands.setTeamsSelectedBulk).toHaveBeenCalledWith({
      t1: true,
      t2: true,
    });
  });
});
