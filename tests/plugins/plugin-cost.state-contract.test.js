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
    getSelectedTaskTypeNames: vi.fn(() => ['Epic', 'Feature']),
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
import { renderCountingBanner } from '../../www/js/plugins/PluginCostShared.js';
import { render } from '../../www/js/vendor/lit.js';

describe('plugin cost pluginState seam', () => {
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

  it('reports complete Context without applying board type filters', async () => {
    const parent = {
      id: 'parent',
      project: 'plan-1',
      type: 'Epic',
      capacity: [{ team: 'team-1', capacity: 100 }],
    };
    const child = {
      id: 'child',
      project: 'internal-owner',
      parentId: 'parent',
      type: 'Requirement',
      sourcePlanIds: ['plan-1'],
      presentationPlanIds: [],
      traversalBoundary: false,
      excludedChildIds: [],
      capacity: [{ team: 'team-1', capacity: 100 }],
    };
    mockSel.scope.getContextFeatures.mockReturnValue([parent, child]);
    mockSel.feature.getEffectiveFeatures.mockReturnValue([parent, child]);
    mockSel.scope.getVisibleFeatures.mockImplementation(() => {
      throw new Error('Cost reporting must not use final visible scope');
    });
    mockSel.feature.getChildrenByParentMap.mockReturnValue(
      new Map([['parent', ['child']]])
    );
    const querySelector = vi.spyOn(document, 'querySelector');
    const getCost = vi.spyOn(dataService, 'getCost').mockResolvedValue({ ok: true, data: { projects: [] } });
    vi.spyOn(dataService, 'getCostTeams').mockResolvedValue({ ok: true, data: { teams: [] } });

    const plugin = new PluginCostComponent();
    await plugin.loadData();

    expect(getCost).toHaveBeenCalledOnce();
    expect(getCost.mock.calls[0][0].features.map((feature) => feature.id)).toEqual([
      'parent', 'child',
    ]);
    expect(getCost.mock.calls[0][0].features[1].capacity).toBe(child.capacity);
    expect(getCost.mock.calls[0][0].features[1].sourcePlanIds).toEqual(['plan-1']);
    expect(getCost.mock.calls[0][0].features[1].presentationPlanIds).toEqual([]);
    expect(getCost.mock.calls[0][0].features[1].traversalBoundary).toBe(false);
    expect(plugin.data).toEqual({ projects: {} });

    const contextFeature = {
      id: 'context-feature',
      project: 'context-plan',
      type: 'Feature',
      capacity: [{ team: 'team-2', capacity: 40 }],
    };
    mockSel.scope.getContextFeatures.mockReturnValue([contextFeature]);
    mockSel.feature.getEffectiveFeatures.mockReturnValue([contextFeature]);
    await plugin.loadData();

    expect(getCost.mock.calls[1][0].features.map((feature) => feature.id)).toEqual([
      'context-feature',
    ]);
    expect(getCost.mock.calls[1][0].features[0].capacity).toBe(contextFeature.capacity);
    expect(mockSel.scope.getContextFeatures).toHaveBeenCalledTimes(2);
    expect(mockSel.scope.getVisibleFeatures).not.toHaveBeenCalled();
    expect(querySelector).not.toHaveBeenCalledWith('app-sidebar');
    const previousData = plugin.data;
    getCost.mockResolvedValue({ ok: false, error: { message: 'cost_unavailable', status: 503 } });
    await plugin.loadData();
    expect(plugin.error).toBe('cost_unavailable');
    expect(plugin.data).toBe(previousData);
    querySelector.mockRestore();
  });

  it('renders allocation-scope counting rules without a mounted Sidebar', () => {
    const querySelector = vi.spyOn(document, 'querySelector');
    const root = document.createElement('div');
    render(renderCountingBanner(), root);
    expect(root.textContent).toContain('Complete allocation context');
    expect(root.textContent).toContain('Child-team precedence');
    expect(querySelector).not.toHaveBeenCalledWith('app-sidebar');
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