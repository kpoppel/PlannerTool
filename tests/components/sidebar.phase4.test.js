import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  availableTaskTypesOrdered: ['epic', 'feature'],
  availableFeatureStates: ['New', 'Doing'],
  baselineFeatures: [],
  taskTypeHierarchy: [],
  getTypeLevel: () => 0,
  getFeatureStateColors: () => ({}),
  getFeatureStateColor: () => '#999',
}));

const mockCmd = vi.hoisted(() => ({
  filter: {
    setSelectedTaskTypes: vi.fn(),
    toggleStateSelected: vi.fn(),
    setSidebarDisabledElements: vi.fn(),
    clearSidebarDisabledElements: vi.fn(),
  },
  view: {
    setTypeVisibility: vi.fn(),
    setTimelineScale: vi.fn(),
    setCondensedCards: vi.fn(),
    setFeatureSortMode: vi.fn(),
    setCapacityViewMode: vi.fn(),
    setDisplayMode: vi.fn(),
    setExpansionState: vi.fn(),
  },
}));

const mockSel = vi.hoisted(() => ({
  selection: {
    getSelectedProjectIds: () => [],
    getSelectedTeamIds: () => [],
  },
  filter: {
    getSelectedFeatureStateSet: () => new Set(['New']),
    getAvailableFeatureStates: () => ['New', 'Doing'],
  },
  view: {
    isTypeVisible: () => true,
    getCondensedCards: () => false,
    getTimelineScale: () => 'months',
    getFeatureSortMode: () => 'rank',
    getPackedMode: () => false,
    getDisplayMode: () => 'normal',
    getCapacityViewMode: () => 'team',
    getExpansionState: () => ({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    }),
  },
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: mockState,
  PALETTE: {},
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: mockSel,
}));

import { SidebarLit } from '../../www/js/components/Sidebar.lit.js';

describe('Sidebar Phase 4 command/selector seam', () => {
  beforeEach(() => {
    mockCmd.filter.setSelectedTaskTypes.mockReset();
    mockCmd.filter.toggleStateSelected.mockReset();
    mockCmd.filter.setSidebarDisabledElements.mockReset();
    mockCmd.filter.clearSidebarDisabledElements.mockReset();

    mockCmd.view.setTypeVisibility.mockReset();
    mockCmd.view.setTimelineScale.mockReset();
    mockCmd.view.setCondensedCards.mockReset();
    mockCmd.view.setFeatureSortMode.mockReset();
    mockCmd.view.setCapacityViewMode.mockReset();
    mockCmd.view.setDisplayMode.mockReset();
    mockCmd.view.setExpansionState.mockReset();

    mockSel.view.isTypeVisible = () => true;
    mockSel.view.getCondensedCards = () => false;
    mockSel.view.getExpansionState = () => ({
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    });
  });

  it('setTaskTypeChecked updates cmd.view and cmd.filter', () => {
    const sidebar = new SidebarLit();
    sidebar.selectedTaskTypes = new Set(['feature', 'epic']);

    sidebar.setTaskTypeChecked('feature', false);

    expect(mockCmd.view.setTypeVisibility).toHaveBeenCalledWith('feature', false);
    expect(mockCmd.filter.setSelectedTaskTypes).toHaveBeenCalledWith(['epic']);
  });

  it('toggleTaskType uses selector visibility and command seam', () => {
    const sidebar = new SidebarLit();
    sidebar.selectedTaskTypes = new Set(['feature']);
    mockSel.view.isTypeVisible = () => true;

    sidebar._toggleTaskType('feature');

    expect(mockCmd.view.setTypeVisibility).toHaveBeenCalledWith('feature', false);
    expect(mockCmd.filter.setSelectedTaskTypes).toHaveBeenCalledWith([]);
  });

  it('view option handlers delegate through cmd.view', () => {
    const sidebar = new SidebarLit();

    sidebar._setTimelineScale('quarters');
    sidebar._toggleCondensed();
    sidebar._setFeatureSortMode('date');
    sidebar._setGraphType('project');

    expect(mockCmd.view.setTimelineScale).toHaveBeenCalledWith('quarters');
    expect(mockCmd.view.setCondensedCards).toHaveBeenCalledWith(true);
    expect(mockCmd.view.setFeatureSortMode).toHaveBeenCalledWith('date');
    expect(mockCmd.view.setCapacityViewMode).toHaveBeenCalledWith('project');
  });

  it('hydrates expansion toggles from selector state', () => {
    const sidebar = new SidebarLit();
    sidebar.expandParentChild = true;
    sidebar.expandRelations = true;
    sidebar.expandTeamAllocated = true;

    mockSel.view.getExpansionState = () => ({
      expandParentChild: false,
      expandRelations: true,
      expandTeamAllocated: false,
    });

    sidebar._syncExpansionFromSelectors();

    expect(sidebar.expandParentChild).toBe(false);
    expect(sidebar.expandRelations).toBe(true);
    expect(sidebar.expandTeamAllocated).toBe(false);
  });
});
