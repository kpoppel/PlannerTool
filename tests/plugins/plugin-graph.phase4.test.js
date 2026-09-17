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
    getProjects: () => [{ id: 'p1', selected: true, type: 'project' }],
    getSelectedTeamIds: () => ['t1'],
    getSelectedProjectIds: () => ['p1'],
  },
  scope: {
    getVisibleTeams: () => ['t1'],
    getTeamDrilldownIds: () => ['t1'],
  },
  capacity: {
    getCapacityDates: () => ['2025-01-01'],
    getTeamDailyCapacity: () => [[12]],
    getProjectDailyCapacity: () => [[24]],
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

describe('PluginGraph Phase 4 selector seam', () => {
  beforeEach(() => {
    mockSel.filter.getSelectedFeatureStateNames = () => [];
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
});
