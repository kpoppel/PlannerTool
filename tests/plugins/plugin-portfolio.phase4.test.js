import { describe, it, expect, vi } from 'vitest';

const mockSel = vi.hoisted(() => ({
  selection: {
    getProjects: vi.fn(() => [{ id: 'p1', name: 'Plan 1', selected: true }]),
    getTeams: vi.fn(() => [{ id: 't1', name: 'Team 1', selected: true }]),
    getSelectedProjectIds: vi.fn(() => ['p1']),
    getSelectedTeamIds: vi.fn(() => ['t1']),
  },
  scope: {
    getVisibleFeatures: vi.fn(() => [{
      id: 'f1',
      project: 'p1',
      state: 'Doing',
      type: 'feature',
      capacity: [{ team: 't1', capacity: 8 }],
    }]),
    getVisibleTeams: vi.fn(() => ['t1']),
    getTeamDrilldownIds: vi.fn(() => ['t1']),
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
    expect(el._planTeamEquivalents).to.deep.equal([
      { planId: 'p1', planName: 'Plan 1', teamCount: 1, equivalent: 0.08 },
    ]);
  });

  it('uses canonical visible features instead of legacy expansion scope', () => {
    mockSel.feature.getEffectiveFeatures.mockReturnValue([]);
    mockSel.scope.getVisibleFeatures.mockReturnValue([{
      id: 'f2',
      project: 'p1',
      state: 'Doing',
      type: 'feature',
      capacity: [{ team: 't1', capacity: 4 }],
    }]);

    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._rows[0].cells.Doing[0].feature.id).to.equal('f2');
    expect(mockSel.feature.getEffectiveFeatures).not.toHaveBeenCalled();
  });

  it('counts each team allocation once in a plan rollup', () => {
    mockSel.scope.getVisibleFeatures.mockReturnValue([{
      id: 'f3',
      project: 'p1',
      state: 'Doing',
      type: 'feature',
      capacity: [
        { team: 't1', capacity: 40 },
        { team: 't2', capacity: 60 },
      ],
    }]);
    mockSel.selection.getTeams.mockReturnValue([
      { id: 't1', name: 'Team 1' },
      { id: 't2', name: 'Team 2' },
    ]);
    mockSel.scope.getTeamDrilldownIds.mockReturnValue(['t1', 't2']);

    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._planTeamEquivalents[0]).to.deep.equal({
      planId: 'p1', planName: 'Plan 1', teamCount: 2, equivalent: 1,
    });
  });

  it('does not turn an empty Team Drill-down into an all-team rollup', () => {
    mockSel.scope.getVisibleFeatures.mockReturnValue([{
      id: 'f4',
      project: 'p1',
      state: 'Doing',
      type: 'feature',
      capacity: [{ team: 't1', capacity: 100 }],
    }]);
    mockSel.scope.getTeamDrilldownIds.mockReturnValue([]);

    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._rows).to.have.length(0);
    expect(el._planTeamEquivalents).to.deep.equal([]);
  });

  it('keeps cross-plan visible allocations in separate rollups', () => {
    mockSel.selection.getProjects.mockReturnValue([
      { id: 'p1', name: 'Plan 1', selected: true },
      { id: 'p2', name: 'Plan 2', selected: true },
    ]);
    mockSel.selection.getTeams.mockReturnValue([
      { id: 't1', name: 'Team 1' },
      { id: 't2', name: 'Team 2' },
    ]);
    mockSel.scope.getTeamDrilldownIds.mockReturnValue(['t1', 't2']);
    mockSel.scope.getVisibleFeatures.mockReturnValue([
      {
        id: 'f5',
        project: 'p1',
        state: 'Doing',
        type: 'feature',
        capacity: [{ team: 't1', capacity: 50 }],
      },
      {
        id: 'f6',
        project: 'p2',
        state: 'Doing',
        type: 'feature',
        capacity: [{ team: 't2', capacity: 100 }],
      },
    ]);

    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._planTeamEquivalents).to.deep.equal([
      { planId: 'p1', planName: 'Plan 1', teamCount: 1, equivalent: 0.5 },
      { planId: 'p2', planName: 'Plan 2', teamCount: 1, equivalent: 1 },
    ]);
  });
});