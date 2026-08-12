import { describe, it, expect, vi } from 'vitest';

const mockSel = vi.hoisted(() => ({
  selection: {
    getProjects: vi.fn(() => [{ id: 'p1', name: 'Plan 1', selected: true }]),
    getTeams: vi.fn(() => [{ id: 't1', name: 'Team 1', selected: true }]),
    getSelectedProjectIds: vi.fn(() => ['p1']),
    getSelectedTeamIds: vi.fn(() => ['t1']),
  },
  filter: {
    getSelectedFeatureStateNames: vi.fn(() => ['Doing']),
    getAvailableFeatureStates: vi.fn(() => ['Doing']),
    featurePassesFilters: vi.fn(() => true),
    compareFeatureStates: vi.fn((a, b) => a.localeCompare(b)),
  },
  feature: {
    getAvailableTaskTypes: vi.fn(() => ['feature']),
    getEffectiveFeatures: vi.fn(() => [
      {
        id: 'f1',
        project: 'p1',
        state: 'Doing',
        type: 'feature',
        capacity: [{ team: 't1', capacity: 8 }],
      },
    ]),
  },
  view: {
    isTypeVisible: vi.fn(() => true),
    getExpansionState: vi.fn(() => ({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    })),
    getExpandedFeatureIds: vi.fn(() => new Set(['f1'])),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  sel: mockSel,
}));

import { PluginPortfolioComponent } from '../../www/js/plugins/PluginPortfolioComponent.lit.js';

describe('PluginPortfolioComponent selector seam', () => {
  it('builds rows from selector-driven project, team, and state visibility', () => {
    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._columnStates).to.deep.equal(['Doing']);
    expect(el._rows).to.have.length(1);
    expect(el._rows[0].team.id).to.equal('t1');
  });
});