import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  availableTaskTypes: ['epic', 'feature'],
  teams: [],
  baselineFeatures: [{ id: 'f-base' }],
  getEffectiveFeatures: () => [],
  taskFilterService: null,
}));

const mockSel = vi.hoisted(() => ({
  feature: {
    getEffectiveFeatures: () => [],
    getAvailableTaskTypes: () => ['epic', 'feature'],
    getBaselineFeatures: () => [{ id: 'f-base' }],
  },
  selection: {
    getTeams: () => [],
    getSelectedProjectIds: () => [],
    getSelectedTeamIds: () => [],
  },
  filter: {
    getSelectedFeatureStateSet: () => new Set(),
  },
  view: {
    isTypeVisible: () => true,
    getShowUnplannedWork: () => true,
    getExpansionState: () => ({ expandTeamAllocated: false }),
    getShowOnlyProjectHierarchy: () => false,
    getExpandedFeatureIds: () => new Set(),
  },
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: mockState,
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: mockSel,
}));

vi.mock('../../www/js/config.js', () => ({
  featureFlags: {
    SHOW_UNPLANNED_WORK: true,
  },
}));

import { EmptyBoardModal } from '../../www/js/components/EmptyBoardModal.lit.js';

describe('EmptyBoardModal Phase 4 selector seam', () => {
  beforeEach(() => {
    mockState.availableTaskTypes = ['epic', 'feature'];
    mockState.teams = [];
    mockState.baselineFeatures = [{ id: 'f-base' }];
    mockState.getEffectiveFeatures = () => [];
    mockState.taskFilterService = null;
    mockSel.feature.getEffectiveFeatures = () => [];
    mockSel.feature.getAvailableTaskTypes = () => ['epic', 'feature'];
    mockSel.feature.getBaselineFeatures = () => [{ id: 'f-base' }];

    mockSel.selection.getSelectedProjectIds = () => [];
    mockSel.selection.getSelectedTeamIds = () => [];
    mockSel.selection.getTeams = () => [];
    mockSel.filter.getSelectedFeatureStateSet = () => new Set();
    mockSel.view.isTypeVisible = () => true;
    mockSel.view.getShowUnplannedWork = () => true;
    mockSel.view.getExpansionState = () => ({ expandTeamAllocated: false });
    mockSel.view.getShowOnlyProjectHierarchy = () => false;
    mockSel.view.getExpandedFeatureIds = () => new Set();
    mockSel.filter.getTaskFilters = () => null;
    mockSel.filter.featurePassesFilters = () => true;
  });

  it('reports selector-driven reasons when no projects or states are selected', () => {
    const modal = new EmptyBoardModal();

    const reasons = modal._computeReasons();

    expect(reasons.some((r) => r.includes('No projects/plans selected'))).toBe(true);
    expect(reasons.some((r) => r.includes('Feature state filter excludes all states'))).toBe(
      true
    );
  });

  it('detects visible features via selector seam without direct in-scope state calls', () => {
    mockSel.feature.getEffectiveFeatures = () => [
      { id: 'f1', state: 'Active', type: 'feature', start: '2025-01-01', end: '2025-01-02' },
    ];
    mockSel.view.getExpandedFeatureIds = () => new Set(['f1']);
    mockSel.filter.getSelectedFeatureStateSet = () => new Set(['Active']);
    mockSel.view.isTypeVisible = () => true;
    mockSel.view.getShowUnplannedWork = () => true;

    const modal = new EmptyBoardModal();
    expect(modal._hasVisibleFeatures()).toBe(true);
  });
});
