import { describe, it, expect, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  projects: [{ id: 'p1' }],
  teams: [{ id: 't1' }],
  capacityDates: ['2025-01-01'],
  projectDailyCapacity: [[10]],
  teamDailyCapacity: [[5]],
  features: [{ id: 'f1' }],
}));

const mockSel = vi.hoisted(() => ({
  view: {
    getCapacityViewMode: () => 'team',
    getHiddenTypes: () => new Set(['epic']),
    getShowDependencies: () => true,
  },
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: mockState,
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: mockSel,
}));

import { PluginExportTimeline } from '../../www/js/plugins/PluginExportTimelineComponent.js';

describe('PluginExportTimelineComponent Phase 4 selector seam', () => {
  it('collects timeline export data using sel.view for view snapshot fields', () => {
    const el = new PluginExportTimeline();

    const data = el._collectTimelineData();

    expect(data.projects).toEqual([{ id: 'p1' }]);
    expect(data.teams).toEqual([{ id: 't1' }]);
    expect(data.view).toEqual({
      capacityMode: 'team',
      hiddenTypes: ['epic'],
      showDependencies: true,
    });
  });
});
