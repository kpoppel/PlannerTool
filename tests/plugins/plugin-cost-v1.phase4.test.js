import { describe, it, expect, vi } from 'vitest';

const mockSel = vi.hoisted(() => ({
  filter: {
    getAvailableFeatureStates: vi.fn(() => ['New', 'Doing']),
  },
}));

const mockState = vi.hoisted(() => ({
  _colorService: {
    getFeatureStateColors: vi.fn(() => ({
      New: { background: '#111', text: '#fff' },
      Doing: { background: '#222', text: '#fff' },
    })),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: mockSel,
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: mockState,
}));

import { PluginCostV1Component } from '../../www/js/plugins/PluginCostV1Component.js';

describe('PluginCostV1Component Phase 4 selector seam', () => {
  it('uses sel.filter available states when building state color map', () => {
    const el = new PluginCostV1Component();
    el.data = { projects: [] };
    el.projects = [];
    el.months = [];

    el.render();

    expect(mockSel.filter.getAvailableFeatureStates).toHaveBeenCalled();
    expect(mockState._colorService.getFeatureStateColors).toHaveBeenCalledWith([
      'New',
      'Doing',
    ]);
  });
});
