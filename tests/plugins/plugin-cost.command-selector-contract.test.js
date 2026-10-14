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
    getSelectedFeatureStateSet: vi.fn(() => new Set(['Active'])),
    getTaskFilters: vi.fn(() => ({ schedule: { unplanned: false } })),
    featurePassesFilters: vi.fn(() => true),
  },
  scope: { getContextFeatures: vi.fn(), getVisibleFeatures: vi.fn(() => []) },
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

  it('defaults unplanned off but enables state, schedule and allocation controls', () => {
    mockSel.filter.getTaskFilters.mockReturnValue({
      schedule: { planned: true, unplanned: false },
      allocation: { allocated: true, unallocated: true },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true },
    });
    const plugin = new PluginCostComponent();

    plugin._applySidebarDisabled();

    expect(mockCmd.filter.setTaskFilter).toHaveBeenCalledWith('schedule', 'unplanned', false,
      { suppressEvents: true });
    expect(mockCmd.filter.setAllStatesSelected).not.toHaveBeenCalled();
    expect(mockCmd.filter.setSelectedTaskTypes).not.toHaveBeenCalled();
    expect(mockCmd.filter.setSidebarDisabledElements).toHaveBeenCalledWith({
      taskFilters: { hierarchy: ['hasParent', 'noParent'], relations: ['hasLinks', 'noLinks'] },
    });
  });

  it('routes close cleanup through cmd.filter', () => {
    const plugin = new PluginCostComponent();

    plugin.close();

    expect(mockCmd.filter.clearSidebarDisabledElements).toHaveBeenCalled();
  });

  it('sends the complete effective graph before applying report filters', async () => {
    const parent = { id: 'parent', state: 'Active', project: 'p1', start: '2025-01-01', end: '2025-01-31',
      capacity: [{ team: 'A', capacity: 100 }], ancestorOnly: false };
    const child = { id: 'child', state: 'Active', parentId: 'parent', project: 'p2', start: null, end: null,
      capacity: [{ team: 'A', capacity: 20 }], ancestorOnly: false, stateCategory: 'Completed' };
    mockSel.feature.getEffectiveFeatures.mockReturnValue([parent, child]);
    mockSel.scope.getContextFeatures.mockReturnValue([parent]);
    mockSel.scope.getVisibleFeatures.mockReturnValue([parent]);
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
    expect(plugin.data.projects.p1.features.map((feature) => feature.id)).toEqual(['parent', 'child']);
    expect(plugin.data.projects.p1.features.map((feature) => feature.displayMode))
      .toEqual(['normal', 'context']);
    expect(plugin.data.projects.p1.features[1].stateCategory).toEqual('Completed');
    expect(Object.keys(plugin.data.projects)).toEqual(['p1', 'p2']);
  });

  it('excludes context rows rejected by state or task filters without dropping financial records', async () => {
    const base = { state: 'Active', project: 'p1', capacity: [{ team: 'A', capacity: 20 }] };
    const features = [
      { ...base, id: 'normal' }, { ...base, id: 'closed', state: 'Closed' },
      { ...base, id: 'filtered' }, { ...base, id: 'hidden-type' },
    ];
    mockSel.feature.getEffectiveFeatures.mockReturnValue(features);
    mockSel.scope.getContextFeatures.mockReturnValue(features);
    mockSel.scope.getVisibleFeatures.mockReturnValue([features[0]]);
    mockSel.filter.featurePassesFilters.mockImplementation((feature) => feature.id !== 'filtered');
    mockDataService.getCost.mockResolvedValue({ ok: true, data: { projects: [
      { id: 'p1', features: features.map((feature) => ({ id: feature.id })) },
    ] } });
    const plugin = new PluginCostComponent();
    await plugin.loadData();
    expect(plugin.error).toBeNull();
    expect(plugin.data.projects.p1.features.map((feature) => feature.displayMode))
      .toEqual(['normal', 'excluded', 'excluded', 'context']);
    expect(mockDataService.getCost.mock.calls.at(-1)[0].features).toEqual(features);
  });
});