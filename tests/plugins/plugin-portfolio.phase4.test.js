import { describe, it, expect, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  projects: [{ id: 'p1', name: 'Plan 1', selected: true }],
  teams: [{ id: 't1', name: 'Team 1', selected: true, color: '#123456' }],
  availableTaskTypes: ['feature'],
  taskFilterService: { featurePassesFilters: () => true },
  compareFeatureStates: (a, b) => a.localeCompare(b),
}));

const mockCmd = vi.hoisted(() => ({
  feature: {
    updateFeatureField: vi.fn(),
  },
}));

const mockSel = vi.hoisted(() => ({
  selection: {
    getProjects: () => mockState.projects,
    getTeams: () => mockState.teams,
    getSelectedProjectIds: () => ['p1'],
    getSelectedTeamIds: () => ['t1'],
  },
  filter: {
    getSelectedFeatureStateNames: () => ['Doing'],
    getAvailableFeatureStates: () => ['Doing'],
    featurePassesFilters: () => true,
    compareFeatureStates: (a, b) => a.localeCompare(b),
  },
  feature: {
    getAvailableTaskTypes: () => ['feature'],
    getEffectiveFeatures: () => [
      {
        id: 'f1',
        project: 'p1',
        state: 'Doing',
        type: 'feature',
        capacity: [{ team: 't1', capacity: 8 }],
      },
    ],
  },
  view: {
    isTypeVisible: () => true,
    getExpansionState: () => ({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    }),
    getExpandedFeatureIds: () => new Set(['f1']),
  },
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: mockState,
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: mockSel,
}));

import { PluginPortfolioComponent } from '../../www/js/plugins/PluginPortfolioComponent.lit.js';

describe('PluginPortfolioComponent Phase 4 selector seam', () => {
  it('builds rows from selector-driven project/team/state visibility', () => {
    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._columnStates).toEqual(['Doing']);
    expect(el._rows.length).toBe(1);
    expect(el._rows[0].team.id).toBe('t1');
  });
});
