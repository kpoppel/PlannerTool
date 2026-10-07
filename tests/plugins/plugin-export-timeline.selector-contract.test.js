import { describe, it, expect, vi } from 'vitest';

const mockNotify = vi.hoisted(() => vi.fn());

const mockSel = vi.hoisted(() => ({
  selection: {
    getProjects: () => [{ id: 'p1' }],
    getTeams: () => [{ id: 't1' }],
  },
  capacity: {
    getCapacityDates: () => ['2025-01-01'],
    getProjectDailyCapacity: () => [[10]],
    getTeamDailyCapacity: () => [[5]],
  },
  feature: {
    getEffectiveFeatures: () => [{ id: 'f1' }],
  },
  view: {
    getCapacityViewMode: () => 'team',
    getHiddenTypes: () => new Set(['epic']),
    getContext: () => ({ dependency: true }),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: { ui: { addNotification: mockNotify } },
  sel: mockSel,
}));

import { PluginExportTimeline } from '../../www/js/plugins/PluginExportTimelineComponent.js';

describe('PluginExportTimelineComponent selector seam', () => {
  it('records export messages immediately without a dimming modal', () => {
    const component = new PluginExportTimeline();

    component._notify('Export failed', 'PNG export failed.', 'error');

    expect(mockNotify).toHaveBeenCalledWith({
      source: 'Timeline export', code: 'Export failed', severity: 'error',
      message: 'PNG export failed.',
    });
    expect(document.getElementById('app-message-modal')).toBe(null);
  });

  it('collects timeline export data using sel.view for view snapshot fields', () => {
    const el = new PluginExportTimeline();

    const data = el._collectTimelineData();

    expect(data.projects).toEqual([{ id: 'p1' }]);
    expect(data.teams).toEqual([{ id: 't1' }]);
    expect(data.view).toEqual({
      capacityMode: 'team',
      hiddenTypes: ['epic'],
      dependencyContext: true,
    });
  });
});
