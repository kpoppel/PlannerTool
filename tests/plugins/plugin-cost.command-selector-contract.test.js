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
    getEffectiveFeatures: vi.fn(),
  },
  filter: {
    getAvailableFeatureStates: vi.fn(() => ['New', 'Doing']),
    getTaskFilters: vi.fn(() => ({ schedule: { unplanned: false } })),
    featurePassesFilters: vi.fn(() => true),
  },
  scope: { getContextFeatures: vi.fn() },
  selection: { getSelectedProjectIds: vi.fn(() => ['p1']) },
}));

const mockDataService = vi.hoisted(() => ({
  getCost: vi.fn(),
  getCostTeams: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock('../../www/js/services/dataService.js', () => ({ dataService: mockDataService }));

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

  it('sends the complete effective graph before applying report filters', async () => {
    const parent = { id: 'parent', project: 'p1', start: '2025-01-01', end: '2025-01-31',
      capacity: [{ team: 'A', capacity: 100 }], ancestorOnly: false };
    const child = { id: 'child', parentId: 'parent', project: 'p2', start: null, end: null,
      capacity: [{ team: 'A', capacity: 20 }], ancestorOnly: false };
    mockSel.feature.getEffectiveFeatures.mockReturnValue([parent, child]);
    mockSel.scope.getContextFeatures.mockReturnValue([parent]);
    mockDataService.getCost.mockResolvedValue({ ok: true, data: { projects: [
      { id: 'p1', features: [{ id: 'parent' }, { id: 'child' }] },
      { id: 'p2', features: [{ id: 'child' }] },
    ] } });
    const plugin = new PluginCostComponent();
    await plugin.loadData();
    expect(plugin.error).toBeNull();
    expect(mockDataService.getCost.mock.calls[0][0].features.map((feature) => feature.id))
      .toEqual(['parent', 'child']);
    expect(mockDataService.getCost.mock.calls[0][0].features[1].ancestorOnly).toBe(false);
    expect(plugin.data.projects.p1.features.map((feature) => feature.id)).toEqual(['parent']);
    expect(Object.keys(plugin.data.projects)).toEqual(['p1']);
  });
});