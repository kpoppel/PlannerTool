/**
 * Unit tests for ViewManagementService
 * Tests view loading, saving, and restoration of view options including expansion filters
 */

import { expect } from '@esm-bundle/chai';
import { ViewManagementService } from '../../www/js/services/ViewManagementService.js';
import { dataService } from '../../www/js/services/dataService.js';

describe('ViewManagementService - Expansion Filters', () => {
  let viewManagementService;
  let mockBus;
  let emitCalls;
  let mockViewService;
  let mockState;
  let originalGetView;
  let mockSidebar;

  beforeEach(() => {
    emitCalls = [];
    mockBus = {
      emit: (event, data) => {
        emitCalls.push({ event, data });
      },
      on: () => {},
      off: () => {},
    };

    mockViewService = {
      setCapacityViewMode: () => {},
      restoreView: () => {},
    };

    mockState = {
      projects: [],
      teams: [],
      availableFeatureStates: [],
      taskFilterService: null,
      _stateFilterService: null,
      setProjectsSelectedBulk: () => {},
      setTeamsSelectedBulk: () => {},
      setExpansionState: (options) => {
        mockState._expansionState = {
          ...mockState._expansionState,
          ...options,
        };
      },
      _expansionState: {
        expandParentChild: false,
        expandRelations: false,
        expandTeamAllocated: false,
      },
    };

    // Mock sidebar element
    mockSidebar = {
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
      _recomputeDataFunnel: null,
      requestUpdate: () => {},
      availableTaskTypes: [],
      selectedTaskTypes: new Set(),
    };

    // Mock document.querySelector
    global.document = {
      querySelector: (selector) => {
        if (selector === 'app-sidebar') return mockSidebar;
        return null;
      },
    };

    viewManagementService = new ViewManagementService(
      mockBus,
      mockState,
      mockViewService
    );

    // Save original dataService.getView
    originalGetView = dataService.getView;
  });

  afterEach(() => {
    // Restore original method
    dataService.getView = originalGetView;
  });

  describe('loadAndApplyView with Expansion Filters', () => {
    it('should sync expansion state to State service when loading view', async () => {
      // Mock the getView response
      const mockViewData = {
        id: 'test-view-1',
        name: 'Test View',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {
          expandParentChild: true,
          expandRelations: true,
          expandTeamAllocated: false,
        },
      };

      dataService.getView = async () => mockViewData;

      // Load the view
      await viewManagementService.loadAndApplyView('test-view-1');

      // Verify expansion state was synced to State service
      expect(mockState._expansionState.expandParentChild).to.equal(true);
      expect(mockState._expansionState.expandRelations).to.equal(true);
      expect(mockState._expansionState.expandTeamAllocated).to.equal(false);
    });

    it('should emit filter:changed event when loading view with expansion filters', async () => {
      // Mock the getView response
      const mockViewData = {
        id: 'test-view-2',
        name: 'Test View',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {
          expandParentChild: false,
          expandRelations: true,
          expandTeamAllocated: true,
        },
      };

      dataService.getView = async () => mockViewData;

      // Clear emit calls from initialization
      emitCalls = [];

      // Load the view
      await viewManagementService.loadAndApplyView('test-view-2');

      // Verify filter:changed event was emitted
      const filterChangedEvent = emitCalls.find(
        (call) => call.event === 'filter:changed'
      );
      expect(filterChangedEvent).to.exist;
      expect(filterChangedEvent.data.expansion).to.deep.equal({
        parentChild: false,
        relations: true,
        teamAllocated: true,
      });
    });

    it('should trigger data funnel recomputation when loading view with expansion filters', async () => {
      // Track if _recomputeDataFunnel was called
      let dataFunnelCalled = false;
      mockSidebar._recomputeDataFunnel = () => {
        dataFunnelCalled = true;
      };

      // Mock the getView response
      const mockViewData = {
        id: 'test-view-3',
        name: 'Test View',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {
          expandParentChild: true,
          expandRelations: false,
          expandTeamAllocated: true,
        },
      };

      dataService.getView = async () => mockViewData;

      // Load the view
      await viewManagementService.loadAndApplyView('test-view-3');

      // Verify _recomputeDataFunnel was called
      expect(dataFunnelCalled).to.equal(true);
    });

    it('should not emit expansion events if no expansion filters are in the view', async () => {
      // Mock the getView response
      const mockViewData = {
        id: 'test-view-4',
        name: 'Test View',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {
          graphType: 'team',
          // No expansion filters
        },
      };

      dataService.getView = async () => mockViewData;

      // Clear emit calls from initialization
      emitCalls = [];

      // Load the view
      await viewManagementService.loadAndApplyView('test-view-4');

      // Verify filter:changed event with expansion was NOT emitted
      const expansionFilterEvent = emitCalls.find(
        (call) => call.event === 'filter:changed' && call.data.expansion
      );
      expect(expansionFilterEvent).to.be.undefined;
    });
  });
});
