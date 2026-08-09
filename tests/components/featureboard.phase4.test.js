import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  projects: [],
  teams: [],
  taskFilterService: {
    featurePassesFilters: () => true,
  },
}));

const mockSel = vi.hoisted(() => ({
  feature: {
    getEffectiveFeatures: () => [],
    getEffectiveFeatureById: () => null,
  },
  selection: {
    getSelectedProjectIds: () => [],
    getSelectedTeamIds: () => [],
  },
  filter: {
    getSelectedFeatureStateSet: () => new Set(),
  },
  view: {
    getExpansionState: () => ({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    }),
    getExpandedFeatureIds: () => new Set(),
    getShowOnlyProjectHierarchy: () => false,
    isTypeVisible: () => true,
    getShowUnplannedWork: () => true,
    getShowUnassignedCards: () => true,
  },
  group: {
    getEffectiveGroups: () => [],
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

import '../../www/js/components/FeatureBoard.lit.js';

describe('FeatureBoard Phase 4 selector seam', () => {
  beforeEach(() => {
    mockSel.feature.getEffectiveFeatures = () => [];
    mockSel.feature.getEffectiveFeatureById = () => null;
    mockState.projects = [{ id: 'p1', selected: true, type: 'project' }];
    mockState.teams = [{ id: 't1', selected: true }];
    mockState.taskFilterService = {
      featurePassesFilters: () => true,
    };

    mockSel.selection.getSelectedProjectIds = () => ['p1'];
    mockSel.selection.getSelectedTeamIds = () => ['t1'];
    mockSel.filter.getSelectedFeatureStateSet = () => new Set(['Active']);
    mockSel.view.getExpansionState = () => ({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    });
    mockSel.view.getExpandedFeatureIds = () => new Set();
    mockSel.view.getShowOnlyProjectHierarchy = () => false;
    mockSel.view.isTypeVisible = () => true;
    mockSel.view.getShowUnplannedWork = () => true;
    mockSel.view.getShowUnassignedCards = () => true;
  });

  it('passes filters for selected project feature using selector seam', () => {
    const FeatureBoardClass = customElements.get('feature-board');
    const board = new FeatureBoardClass();
    const feature = {
      id: 'f1',
      project: 'p1',
      state: 'Active',
      type: 'feature',
      capacity: [{ team: 't1', capacity: 1 }],
      start: '2025-01-01',
      end: '2025-01-02',
    };

    const result = board._featurePassesFilters(feature, new Map(), [feature]);

    expect(result).toBe(true);
  });

  it('respects selector-provided expansion set filtering', () => {
    mockSel.view.getExpansionState = () => ({
      expandParentChild: true,
      expandRelations: false,
      expandTeamAllocated: false,
    });
    mockSel.view.getExpandedFeatureIds = () => new Set(['f-other']);

    const FeatureBoardClass = customElements.get('feature-board');
    const board = new FeatureBoardClass();
    const feature = {
      id: 'f1',
      project: 'p1',
      state: 'Active',
      type: 'feature',
      capacity: [{ team: 't1', capacity: 1 }],
      start: '2025-01-01',
      end: '2025-01-02',
    };

    const result = board._featurePassesFilters(feature, new Map(), [feature]);

    expect(result).toBe(false);
  });
});
