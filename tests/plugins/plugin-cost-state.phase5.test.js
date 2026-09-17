import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  selection: {
    getSelectedProjectIds: vi.fn(() => []),
  },
  scope: {
    getContextFeatures: vi.fn(() => []),
    getVisibleFeatures: vi.fn(() => []),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: mockSel,
}));

import { PluginCostComponent } from '../../www/js/plugins/PluginCostComponent.js';
import { dataService } from '../../www/js/services/dataService.js';

describe('plugin cost phase 5 pluginState seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSel.feature.getChildrenByParentMap.mockReturnValue(new Map());
    mockSel.filter.getTaskFilters.mockReturnValue({ schedule: { unplanned: true } });
    mockSel.scope.getContextFeatures.mockReturnValue([]);
    mockSel.scope.getVisibleFeatures.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('reports changing Context exactly without re-adding filtered parents', async () => {
    const parent = {
      id: 'parent',
      project: 'plan-1',
      type: 'Epic',
      capacity: [{ team: 'team-1', capacity: 100 }],
    };
    const child = {
      id: 'child',
      project: 'plan-1',
      parentId: 'parent',
      type: 'Feature',
      capacity: [{ team: 'team-1', capacity: 100 }],
    };
    mockSel.scope.getContextFeatures.mockReturnValue([parent, child]);
    mockSel.scope.getVisibleFeatures.mockImplementation(() => {
      throw new Error('Cost reporting must not use final visible scope');
    });
    mockSel.feature.getChildrenByParentMap.mockReturnValue(
      new Map([['parent', ['child']]])
    );
    const sidebar = { selectedTaskTypes: new Set(['Epic', 'Feature']) };
    const querySelector = vi.spyOn(document, 'querySelector').mockReturnValue(sidebar);
    const getCost = vi.spyOn(dataService, 'getCost').mockResolvedValue({ projects: [] });
    vi.spyOn(dataService, 'getCostTeams').mockResolvedValue({ teams: [] });

    const plugin = new PluginCostComponent();
    await plugin.loadData();

    expect(getCost).toHaveBeenCalledOnce();
    expect(getCost.mock.calls[0][0].features.map((feature) => feature.id)).toEqual([
      'child',
    ]);
    expect(getCost.mock.calls[0][0].features[0].capacity).toBe(child.capacity);

    const contextFeature = {
      id: 'context-feature',
      project: 'context-plan',
      type: 'Feature',
      capacity: [{ team: 'team-2', capacity: 40 }],
    };
    mockSel.scope.getContextFeatures.mockReturnValue([contextFeature]);
    await plugin.loadData();

    expect(getCost.mock.calls[1][0].features.map((feature) => feature.id)).toEqual([
      'context-feature',
    ]);
    expect(getCost.mock.calls[1][0].features[0].capacity).toBe(contextFeature.capacity);
    expect(mockSel.scope.getContextFeatures).toHaveBeenCalledTimes(2);
    expect(mockSel.scope.getVisibleFeatures).not.toHaveBeenCalled();
    querySelector.mockRestore();
  });

  it('does not call the cost endpoint when Context is empty', async () => {
    const getCost = vi.spyOn(dataService, 'getCost');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const plugin = new PluginCostComponent();

    await plugin.loadData();

    expect(getCost).not.toHaveBeenCalled();
    expect(plugin.error).toBe(
      'No features available. Please ensure one or more plans are selected.'
    );
  });
});