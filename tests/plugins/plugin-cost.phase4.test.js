import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCmd = vi.hoisted(() => ({
  filter: {
    clearSidebarDisabledElements: vi.fn(),
    setAllStatesSelected: vi.fn(),
    setSelectedTaskTypes: vi.fn(),
    setSidebarDisabledElements: vi.fn(),
  },
  view: {
    setExpansionState: vi.fn(),
  },
}));

const mockSel = vi.hoisted(() => ({
  filter: {
    getAvailableFeatureStates: () => ['New', 'Doing'],
  },
  view: {
    getExpandedFeatureIds: () => new Set(),
  },
}));

const mockState = vi.hoisted(() => ({
  availableTaskTypes: ['feature', 'epic'],
  taskFilterService: {
    setFilter: vi.fn(),
  },
  pluginStateService: {
    update: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
  getEffectiveFeatures: () => [],
  childrenByParent: new Map(),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: mockSel,
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: mockState,
}));

import { PluginCostComponent } from '../../www/js/plugins/PluginCostComponent.js';

describe('PluginCostComponent Phase 4 command/selector seam', () => {
  beforeEach(() => {
    mockCmd.filter.clearSidebarDisabledElements.mockReset();
    mockCmd.filter.setAllStatesSelected.mockReset();
    mockCmd.filter.setSelectedTaskTypes.mockReset();
    mockCmd.filter.setSidebarDisabledElements.mockReset();
    mockCmd.view.setExpansionState.mockReset();
    mockState.taskFilterService.setFilter.mockReset();
  });

  it('routes sidebar disable flow through cmd.filter/cmd.view', () => {
    const el = new PluginCostComponent();
    el._applySidebarDisabled();

    expect(mockCmd.filter.setAllStatesSelected).toHaveBeenCalledWith(true);
    expect(mockCmd.filter.setSelectedTaskTypes).toHaveBeenCalledWith(['feature', 'epic']);
    expect(mockCmd.filter.setSidebarDisabledElements).toHaveBeenCalled();
    expect(mockCmd.view.setExpansionState).toHaveBeenCalledWith({
      expandParentChild: true,
      expandRelations: true,
      expandTeamAllocated: true,
    });
  });

  it('routes close cleanup through cmd.filter/cmd.view', () => {
    const el = new PluginCostComponent();
    el.close();

    expect(mockCmd.filter.clearSidebarDisabledElements).toHaveBeenCalled();
    expect(mockCmd.view.setExpansionState).toHaveBeenCalledWith({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    });
  });
});
