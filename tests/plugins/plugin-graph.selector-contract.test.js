import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSel = vi.hoisted(() => ({
  view: {
    getCapacityViewMode: () => 'team',
  },
  feature: {
    getEffectiveFeatures: () => [],
  },
  selection: {
    getTeams: () => [{ id: 't1', selected: true }],
    getProjects: () => [{ id: 'p1', selected: true, type: 'project' },
      { id: 'program-1', type: 'program' }, { id: 'program-2', type: 'program' }],
    getSelectedTeamIds: () => ['t1'],
    getSelectedProjectIds: () => ['p1'],
  },
  scope: {
    getVisibleTeams: () => ['t1'],
    getTeamDrilldownIds: () => ['t1'],
    getContextFeatures: () => [{ project: 'p1' }, { project: 'program-1' }],
  },
  capacity: {
    getCapacityDates: () => ['2025-01-01'],
    getTeamDailyCapacity: () => [[12]],
    getProjectDailyCapacity: () => [[24]],
    getPlanDailyCapacityMap: () => [{ p1: 24, 'program-1': 30, 'program-2': 20 }],
    getPlanTeamDailyCapacityMap: () => [{ p1: { t1: 24 } }],
  },
  filter: {
    getSelectedFeatureStateNames: () => [],
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: mockSel,
}));

vi.mock('../../www/js/components/Timeline.lit.js', () => ({
  getTimelineMonths: () => [new Date('2025-01-01')],
  TIMELINE_CONFIG: { monthWidth: 120 },
}));

import { PluginGraph } from '../../www/js/plugins/PluginGraphComponent.js';

describe('PluginGraph selector seam', () => {
  beforeEach(() => {
    mockSel.filter.getSelectedFeatureStateNames = () => [];
    mockSel.scope.getTeamDrilldownIds = () => ['t1'];
    mockSel.selection.getProjects = () => [
      { id: 'p1', type: 'project', container_order: 1, container_types: ['program', 'project', 'team'] },
      { id: 'program-1', type: 'program', container_order: 0, container_types: ['program', 'project', 'team'] },
      { id: 'program-2', type: 'program', container_order: 0, container_types: ['program', 'project', 'team'] },
      { id: 'team-f', type: 'team', container_order: 2, container_types: ['program', 'project', 'team'] },
    ];
    mockSel.selection.getSelectedProjectIds = () => ['p1'];
    mockSel.scope.getContextFeatures = () => [{ project: 'p1' }, { project: 'program-1' }];
    mockSel.capacity.getPlanTeamDailyCapacityMap = () => [{ p1: { t1: 24 } }];
  });

  it('uses selector-driven selected states guard in daily totals computation', () => {
    const graph = new PluginGraph();
    const out = graph._computeDailyTotals(
      'team',
      new Date('2025-01-01'),
      new Date('2025-01-01')
    );

    expect(out.days).toBe(0);
    expect(out.totals).toEqual([]);
  });

  it('returns non-empty totals when selector-provided states are present', () => {
    mockSel.filter.getSelectedFeatureStateNames = () => ['Active'];

    const graph = new PluginGraph();
    const out = graph._computeDailyTotals(
      'team',
      new Date('2025-01-01'),
      new Date('2025-01-01')
    );

    expect(out.days).toBeGreaterThan(0);
  });

  it('uses canonical visible teams for Team-mode series', () => {
    mockSel.filter.getSelectedFeatureStateNames = () => ['Active'];
    mockSel.scope.getTeamDrilldownIds = () => [];

    const graph = new PluginGraph();
    const out = graph._computeDailyTotals(
      'team',
      new Date('2025-01-01'),
      new Date('2025-01-01')
    );

    expect(out.days).toBe(0);
    expect(out.totals).toEqual([]);
  });

  it('shows only the scoped ancestor program rollup in the mountain graph', () => {
    mockSel.filter.getSelectedFeatureStateNames = () => ['Active'];
    mockSel.scope.getTeamDrilldownIds = () => ['t1'];
    const graph = new PluginGraph();

    const out = graph._computeDailyTotals('program', new Date('2025-01-01'),
      new Date('2025-01-01'));

    expect(out.totals[0].perProject).toEqual({ 'program-1': 30 });
    expect(out.totals[0].total).toBe(30);
  });

  it('shows team lines for selected team plans without a project plan', () => {
    mockSel.filter.getSelectedFeatureStateNames = () => ['Active'];
    mockSel.selection.getProjects = () => [{ id: 'team-f', type: 'team',
      container_order: 1, container_types: ['project', 'team'] }];
    mockSel.selection.getSelectedProjectIds = () => ['team-f'];
    mockSel.scope.getContextFeatures = () => [{ project: 'team-f' }];
    mockSel.capacity.getPlanTeamDailyCapacityMap = () => [{ 'team-f': { t1: 25 } }];
    const graph = new PluginGraph();

    const out = graph._computeDailyTotals('team', new Date('2025-01-01'),
      new Date('2025-01-01'));

    expect(out.totals[0].perTeam).toEqual({ t1: 25 });
    expect(out.totals[0].total).toBe(25);
  });

  it('uses raw team lines for custom lowest containers and respects empty drill-down', () => {
    mockSel.filter.getSelectedFeatureStateNames = () => ['Active'];
    mockSel.selection.getTeams = () => [{ id: 't1' }, { id: 't2' }];
    mockSel.selection.getProjects = () => [{ id: 'leaf', type: 'squad',
      container_order: 2, container_types: ['portfolio', 'program', 'squad'] }];
    mockSel.scope.getContextFeatures = () => [{ project: 'leaf' }];
    mockSel.capacity.getPlanTeamDailyCapacityMap = () => [{ leaf: { t1: 80 } }];
    const graph = new PluginGraph();
    const out = graph._computeDailyTotals('squad', new Date('2025-01-01'), new Date('2025-01-01'));
    expect(out.totals[0].perTeam).toEqual({ t1: 80 });
    expect(out.totals[0].total).toBe(80);
    mockSel.scope.getTeamDrilldownIds = () => [];
    expect(graph._computeDailyTotals('squad', new Date('2025-01-01'),
      new Date('2025-01-01')).days).toBe(0);
  });
});
