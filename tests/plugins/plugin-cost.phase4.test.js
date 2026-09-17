import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCmd = vi.hoisted(() => ({
  filter: {
    clearSidebarDisabledElements: vi.fn(),
    setAllStatesSelected: vi.fn(),
    setSelectedTaskTypes: vi.fn(),
    setSidebarDisabledElements: vi.fn(),
    setTaskFilter: vi.fn(),
  },
}));

const mockSel = vi.hoisted(() => ({
  feature: {
    getAvailableTaskTypes: vi.fn(() => ['feature', 'epic']),
  },
  filter: {
    getAvailableFeatureStates: vi.fn(() => ['New', 'Doing']),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: mockSel,
}));

import { PluginCostComponent } from '../../www/js/plugins/PluginCostComponent.js';

describe('PluginCostComponent command/selector seam', () => {
  beforeEach(() => {
    mockCmd.filter.clearSidebarDisabledElements.mockReset();
    mockCmd.filter.setAllStatesSelected.mockReset();
    mockCmd.filter.setSelectedTaskTypes.mockReset();
    mockCmd.filter.setSidebarDisabledElements.mockReset();
    mockCmd.filter.setTaskFilter.mockReset();
  });

  it('routes sidebar disable flow through cmd.filter', () => {
    const plugin = new PluginCostComponent();

    plugin._applySidebarDisabled();

    expect(mockCmd.filter.setTaskFilter).toHaveBeenCalledWith(
      'schedule',
      'unplanned',
      false
    );
    expect(mockCmd.filter.setTaskFilter).toHaveBeenCalledWith('schedule', 'planned', true);
    expect(mockCmd.filter.setAllStatesSelected).toHaveBeenCalledWith(true);
    expect(mockCmd.filter.setSelectedTaskTypes).toHaveBeenCalledWith(['feature', 'epic']);
    expect(mockCmd.filter.setSidebarDisabledElements).toHaveBeenCalledWith({
      taskFilters: {
        schedule: ['planned'],
        allocation: ['allocated', 'unallocated'],
        hierarchy: ['hasParent', 'noParent'],
        relations: ['hasLinks', 'noLinks'],
      },
      taskTypes: [],
      states: ['New', 'Doing'],
    });
  });

  it('routes close cleanup through cmd.filter', () => {
    const plugin = new PluginCostComponent();

    plugin.close();

    expect(mockCmd.filter.clearSidebarDisabledElements).toHaveBeenCalled();
  });
});