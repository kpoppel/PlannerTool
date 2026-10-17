import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateFeatureField = vi.hoisted(() => vi.fn(() => true));

const mockSel = vi.hoisted(() => ({
  scenario: {
    isActiveScenarioMutable: vi.fn(() => true),
    getActiveScenarioId: vi.fn(() => 'draft'),
    getActiveScenario: vi.fn(() => ({ id: 'draft', overrides: {} })),
  },
  selection: {
    getProjects: vi.fn(() => [{ id: 'p1', name: 'Plan 1', selected: true }]),
    getTeams: vi.fn(() => [{ id: 't1', name: 'Team 1', selected: true }]),
    getSelectedProjectIds: vi.fn(() => ['p1']),
    getSelectedTeamIds: vi.fn(() => ['t1']),
  },
  scope: {
    getVisibleFeatures: vi.fn(() => [{ process_id: 'process',
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
    getAllocationAvailability: vi.fn(() => ({ allowed_ids: ['t1', 't2'] })),
    getEffectiveFeatureById: vi.fn(),
    getAvailableTaskTypesOrdered: vi.fn(() => ['["process","feature"]']),
    getEffectiveFeatures: vi.fn(() => [
      { process_id: 'process',
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
  },
  capacity: {
    getAllocationSettings: vi.fn(() => ({ unit: 'percent',
      staffing: { status: 'ready', fteById: { t1: 5, t2: 2.5 } } })),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  sel: mockSel,
  cmd: { feature: { updateFeatureField } },
}));

import { PluginPortfolioComponent } from '../../www/js/plugins/PluginPortfolioComponent.lit.js';

describe('PluginPortfolioComponent selector seam', () => {
  beforeEach(() => {
    updateFeatureField.mockClear();
    mockSel.scenario.isActiveScenarioMutable.mockReturnValue(true);
    mockSel.capacity.getAllocationSettings.mockReturnValue({ unit: 'percent',
      staffing: { status: 'ready', fteById: { t1: 5, t2: 2.5 } } });
  });

  it('edits precise man-days without rounding untouched allocations', () => {
    const feature = { id: 'effort', start: '2026-10-05', end: '2026-10-16',
      capacity: [{ team: 't1', capacity: 20.2 }, { team: 't2', capacity: 30 }] };
    mockSel.feature.getEffectiveFeatureById.mockReturnValue(feature);
    mockSel.capacity.getAllocationSettings.mockReturnValue({ unit: 'man-days',
      staffing: { status: 'ready', fteById: { t1: 5, t2: 2.5 } } });
    const el = new PluginPortfolioComponent();
    const input = document.createElement('input');
    input.value = '11';
    el._commitTableAllocation(feature, 't1', input);
    expect(updateFeatureField).not.toHaveBeenCalled();
    input.value = '12';
    el._commitTableAllocation(feature, 't1', input);
    expect(updateFeatureField).toHaveBeenCalledWith('effort', 'capacity', [
      { team: 't1', capacity: 24 }, { team: 't2', capacity: 30 },
    ]);
    expect(feature.capacity[0].capacity).to.equal(20.2);
  });

  it('adds and removes team allocations while rejecting invalid and read-only edits', () => {
    const feature = { id: 'editable', capacity: [{ team: 't1', capacity: 20 }] };
    mockSel.feature.getEffectiveFeatureById.mockReturnValue(feature);
    const el = new PluginPortfolioComponent();
    const input = document.createElement('input');
    input.value = '40';
    el._commitTableAllocation(feature, 't2', input);
    expect(updateFeatureField).toHaveBeenLastCalledWith('editable', 'capacity', [
      { team: 't1', capacity: 20 }, { team: 't2', capacity: 40 },
    ]);
    input.value = '0';
    el._commitTableAllocation(feature, 't1', input);
    expect(updateFeatureField).toHaveBeenLastCalledWith('editable', 'capacity', []);
    updateFeatureField.mockClear();
    for (const value of ['', '-1', '101', '1.5']) {
      input.value = value;
      el._commitTableAllocation(feature, 't1', input);
    }
    mockSel.scenario.isActiveScenarioMutable.mockReturnValue(false);
    input.value = '50';
    el._commitTableAllocation(feature, 't1', input);
    expect(updateFeatureField).not.toHaveBeenCalled();
  });

  it('includes allocated and unallocated sidebar-filtered tasks in the task table', () => {
    const allocated = { process_id: 'process', id: 'allocated', project: 'p1',
      state: 'Doing', type: 'feature', capacity: [{ team: 't1', capacity: 8 }] };
    const unallocated = { ...allocated, id: 'unallocated', capacity: [] };
    const hidden = { ...allocated, id: 'hidden' };
    mockSel.scope.getVisibleFeatures.mockReturnValue([allocated, unallocated, hidden]);
    mockSel.filter.featurePassesFilters.mockImplementation((feature) => feature.id !== 'hidden');

    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._tableFeatures.map((feature) => feature.id)).to.have.members([
      'allocated', 'unallocated',
    ]);
    expect(el._unallocated.map((feature) => feature.id)).to.deep.equal(['unallocated']);
    mockSel.filter.featurePassesFilters.mockReturnValue(true);
  });

  it('renders only used team columns and lets the picker add an editable column', async () => {
    mockSel.selection.getTeams.mockReturnValue([
      { id: 't1', name: 'Team 1' }, { id: 't2', name: 'Team 2' },
    ]);
    mockSel.scope.getVisibleFeatures.mockReturnValue([{ process_id: 'process', id: 'table',
      title: 'Table task', project: 'p1', state: 'Doing', type: 'feature',
      capacity: [{ team: 't1', capacity: 20 }] }]);
    const el = new PluginPortfolioComponent();
    document.body.appendChild(el);
    await el.updateComplete;
    const table = el.shadowRoot.querySelector('.ugrid');
    expect(table.querySelectorAll('.allocation-input')).to.have.length(1);
    expect(table.querySelector('.allocation-input').value).to.equal('20');
    expect(table.querySelector('.allocation-team-picker summary').textContent.trim()).to.equal('+');
    const picker = table.querySelector('select[aria-label="Add allocation team"]');
    expect([...picker.options].map((option) => option.value)).to.deep.equal(['', 't2']);
    picker.value = 't2';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;
    expect(table.querySelectorAll('.allocation-input')).to.have.length(2);
    expect([...table.querySelectorAll('.allocation-heading')].map((heading) =>
      heading.textContent.trim())).to.deep.equal(['Team 1 (%)', 'Team 2 (%)']);
    el.remove();
  });

  it('builds rows from selector-driven project, team, and state visibility', () => {
    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._columnStates).to.deep.equal(['Doing']);
    expect(el._rows).to.have.length(1);
    expect(el._rows[0].team.id).to.equal('t1');
    expect(el._planTeamSummaries).to.deep.equal([
      { planId: 'p1', planName: 'Plan 1', teamCount: 1 },
    ]);
  });

  it('uses canonical visible features instead of legacy expansion scope', () => {
    mockSel.feature.getEffectiveFeatures.mockReturnValue([]);
    mockSel.scope.getVisibleFeatures.mockReturnValue([{ process_id: 'process',
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
    mockSel.scope.getVisibleFeatures.mockReturnValue([{ process_id: 'process',
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

    expect(el._planTeamSummaries[0]).to.deep.equal({
      planId: 'p1', planName: 'Plan 1', teamCount: 2,
    });
  });

  it('reports contributing teams without a non-temporal allocation total', async () => {
    mockSel.scope.getVisibleFeatures.mockReturnValue([{ process_id: 'process',
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
    el.open();
    document.body.appendChild(el);
    await el.updateComplete;

    const rollup = el.shadowRoot.querySelector('.plan-team-rollup');
    expect(rollup.textContent.replace(/\s+/g, ' ').trim()).to.equal(
      'Plan 1 · 2 contributing teams'
    );
    expect(el.shadowRoot.textContent).not.to.include('allocation total');
    el.remove();
  });

  it('does not turn an empty Team Drill-down into an all-team rollup', () => {
    mockSel.scope.getVisibleFeatures.mockReturnValue([{ process_id: 'process',
      id: 'f4',
      project: 'p1',
      state: 'Doing',
      type: 'feature',
      capacity: [],
    }]);
    mockSel.scope.getTeamDrilldownIds.mockReturnValue([]);

    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._rows).to.have.length(0);
    expect(el._planTeamSummaries).to.deep.equal([]);
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
      { process_id: 'process',
        id: 'f5',
        project: 'p1',
        state: 'Doing',
        type: 'feature',
        capacity: [{ team: 't1', capacity: 50 }],
      },
      { process_id: 'process',
        id: 'f6',
        project: 'p2',
        state: 'Doing',
        type: 'feature',
        capacity: [{ team: 't2', capacity: 100 }],
      },
    ]);

    const el = new PluginPortfolioComponent();
    el._refresh();

    expect(el._planTeamSummaries).to.deep.equal([
      { planId: 'p1', planName: 'Plan 1', teamCount: 1 },
      { planId: 'p2', planName: 'Plan 2', teamCount: 1 },
    ]);
  });
});