import { describe, expect, it, vi } from 'vitest';

const mockCmd = vi.hoisted(() => ({
  pluginState: {
    update: vi.fn(),
  },
  filter: {
    clearSidebarDisabledElements: vi.fn(),
    setAllStatesSelected: vi.fn(),
    setSelectedTaskTypes: vi.fn(),
    setSidebarDisabledElements: vi.fn(),
    setTaskFilter: vi.fn(),
  },
  view: {
    setExpansionState: vi.fn(),
  },
}));

const mockSel = vi.hoisted(() => ({
  feature: {
    getAvailableTaskTypes: vi.fn(() => []),
    getChildrenByParentMap: vi.fn(() => new Map()),
    getEffectiveFeatures: vi.fn(() => []),
  },
  filter: {
    getAvailableFeatureStates: vi.fn(() => []),
    getTaskFilters: vi.fn(() => ({ schedule: { unplanned: true } })),
    featurePassesFilters: vi.fn(() => true),
  },
  view: {
    getExpandedFeatureIds: vi.fn(() => new Set()),
  },
  selection: {
    getSelectedProjectIds: vi.fn(() => []),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: mockSel,
}));

import { PluginCostComponent } from '../../www/js/plugins/PluginCostComponent.js';

describe('plugin cost phase 5 pluginState seam', () => {
  it('persists date changes through cmd.pluginState.update', () => {
    const plugin = new PluginCostComponent();
    plugin.pluginId = 'plugin-cost';
    plugin.loadData = vi.fn();
    plugin.startDate = '2026-04-01';
    plugin.endDate = '2026-05-01';

    plugin.handleDateChange();

    expect(mockCmd.pluginState.update).toHaveBeenCalledWith(
      'plugin-cost',
      { startDate: '2026-04-01', endDate: '2026-05-01' },
      { saveToView: true }
    );
    expect(plugin.loadData).toHaveBeenCalledTimes(1);
  });
});