import { describe, expect, it, vi } from 'vitest';

const { mockGet, mockSet, mockUpdate } = vi.hoisted(() => ({
  mockGet: vi.fn(() => ({ startDate: '2026-01-01', endDate: '2026-12-31' })),
  mockSet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    pluginState: {
      get: mockGet,
      set: mockSet,
      update: mockUpdate,
      subscribe: vi.fn(() => () => {}),
    },
    filter: {
      setAllStatesSelected: vi.fn(),
      setSelectedTaskTypes: vi.fn(),
      setSidebarDisabledElements: vi.fn(),
      clearSidebarDisabledElements: vi.fn(),
    },
    view: {
      setExpansionState: vi.fn(),
    },
  },
  sel: {
    filter: {
      getAvailableFeatureStates: vi.fn(() => []),
    },
  },
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: {
    taskFilterService: {
      setFilter: vi.fn(),
    },
    availableTaskTypes: [],
  },
}));

import PluginCost from '../../www/js/plugins/PluginCost.js';
import '../../www/js/plugins/PluginCostComponent.js';

describe('plugin cost phase 5 pluginState seam', () => {
  it('PluginCost activate/deactivate use cmd.pluginState', async () => {
    const plugin = new PluginCost('plugin-cost');
    plugin._el = {
      pluginId: null,
      open: vi.fn(),
      startDate: null,
      endDate: null,
      style: { display: 'none' },
    };

    plugin.mount = vi.fn(async () => plugin._el);
    plugin.unmount = vi.fn(async () => {});

    await plugin.activate();
    expect(mockGet).toHaveBeenCalledWith('plugin-cost');

    plugin._el.startDate = '2026-02-01';
    plugin._el.endDate = '2026-03-01';
    await plugin.deactivate();
    expect(mockSet).toHaveBeenCalledWith(
      'plugin-cost',
      { startDate: '2026-02-01', endDate: '2026-03-01' },
      { saveToView: true }
    );
  });

  it('PluginCostComponent persists date state via cmd.pluginState.update', () => {
    const PluginCostComponent = customElements.get('plugin-cost');
    const el = new PluginCostComponent();
    el.startDate = '2026-04-01';
    el.endDate = '2026-05-01';

    el._persistPluginState();
    expect(mockUpdate).toHaveBeenCalledWith(
      'plugin-cost',
      { startDate: '2026-04-01', endDate: '2026-05-01' },
      { saveToView: true }
    );
  });
});
