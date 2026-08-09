import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelectionCommands = vi.hoisted(() => ({
  setProjectSelected: vi.fn(),
  setProjectsSelectedBulk: vi.fn(),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    selection: mockSelectionCommands,
  },
  sel: {},
}));

import { PlanMenuLit } from '../../www/js/components/PlanMenu.lit.js';

describe('PlanMenu Phase 4 command seam', () => {
  beforeEach(() => {
    mockSelectionCommands.setProjectSelected.mockReset();
    mockSelectionCommands.setProjectsSelectedBulk.mockReset();
  });

  it('routes single toggle through cmd.selection.setProjectSelected', () => {
    const el = new PlanMenuLit();
    el.projects = [{ id: 'p1', selected: false }];

    el._toggleProject('p1');

    expect(mockSelectionCommands.setProjectSelected).toHaveBeenCalledWith('p1', true);
  });

  it('routes bulk toggle through cmd.selection.setProjectsSelectedBulk', () => {
    const el = new PlanMenuLit();
    el.projects = [
      { id: 'p1', selected: true },
      { id: 'p2', selected: false },
    ];

    el._handleProjectToggle();

    expect(mockSelectionCommands.setProjectsSelectedBulk).toHaveBeenCalledWith({
      p1: true,
      p2: true,
    });
  });
});
