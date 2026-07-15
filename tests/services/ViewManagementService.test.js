/**
 * Unit tests for ViewManagementService
 * Tests view loading, saving, and restoration of view options including expansion filters
 */

import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import { ViewManagementService } from '../../www/js/services/ViewManagementService.js';
import { dataService } from '../../www/js/services/dataService.js';
import { FilterEvents } from '../../www/js/core/EventRegistry.js';

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
      savedViews: [],
      activeViewId: null,
      taskFilterService: null,
      _stateFilterService: null,
      setProjectsSelectedBulk: () => {},
      setTeamsSelectedBulk: () => {},
      setSelectedStates: () => {},
      replaceViewState: ({ saved, activeId } = {}) => {
        if (saved !== undefined) mockState.savedViews = saved;
        if (activeId !== undefined) mockState.activeViewId = activeId;
      },
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

    viewManagementService = new ViewManagementService(
      mockBus,
      mockState,
      mockViewService,
      {
        ui: {
          getSidebarElement: () => mockSidebar,
        },
      }
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

    it('should emit FilterEvents.CHANGED event when loading view with expansion filters', async () => {
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

      // Verify FilterEvents.CHANGED event was emitted
      const filterChangedEvent = emitCalls.find(
        (call) => call.event === FilterEvents.CHANGED && call.data.expansion
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

      // Verify FilterEvents.CHANGED event with expansion was NOT emitted
      const expansionFilterEvent = emitCalls.find(
        (call) => call.event === FilterEvents.CHANGED && call.data.expansion
      );
      expect(expansionFilterEvent).to.be.undefined;
    });

    it('should route view restore selection chain through state applyViewSelectionRestore', async () => {
      let restorePayload = null;
      mockState.projects = [{ id: 'p1' }, { id: 'p2' }];
      mockState.teams = [{ id: 't1' }];
      mockState.availableFeatureStates = ['New', 'Doing'];
      mockState.applyViewSelectionRestore = (payload) => {
        restorePayload = payload;
      };

      dataService.getView = async () => ({
        id: 'default',
        name: 'Default View',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {},
      });

      viewManagementService.initDefaultView();

      await viewManagementService.loadAndApplyView('default');

      expect(restorePayload).to.exist;
      expect(restorePayload.projectSelections).to.deep.equal({ p1: true, p2: true });
      expect(restorePayload.teamSelections).to.deep.equal({ t1: true });
      expect(restorePayload.selectedStates).to.deep.equal(['New', 'Doing']);
      expect(restorePayload.resetTaskFilters).to.equal(true);
    });

    it('should route view option and expansion restore through state applyViewOptionsRestore', async () => {
      let optionsPayload = null;
      mockState.applyViewOptionsRestore = (payload) => {
        optionsPayload = payload;
      };
      const directRestoreSpy = sinon.spy();
      mockViewService.restoreView = directRestoreSpy;

      mockSidebar.availableTaskTypes = ['Epic', 'Task'];
      mockViewService.isTypeVisible = (type) => type === 'Epic';

      const mockViewData = {
        id: 'test-view-options',
        name: 'Test View Options',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {
          graphType: 'team',
          expandParentChild: true,
          expandRelations: false,
          expandTeamAllocated: true,
        },
      };

      dataService.getView = async () => mockViewData;

      await viewManagementService.loadAndApplyView('test-view-options');

      expect(optionsPayload).to.exist;
      expect(optionsPayload.graphType).to.equal('team');
      expect(optionsPayload.selectedTaskTypes).to.deep.equal(['Epic']);
      expect(optionsPayload.emitExpansionFilterChange).to.equal(true);
      expect(optionsPayload.expansion).to.deep.equal({
        expandParentChild: true,
        expandRelations: false,
        expandTeamAllocated: true,
      });
      expect(directRestoreSpy.called).to.equal(false);
    });

    it('should route sidebar sync through UI adapter hooks', async () => {
      const uiCalls = [];
      const serviceWithUiAdapter = new ViewManagementService(mockBus, mockState, mockViewService, {
        ui: {
          getSidebarElement: () => mockSidebar,
          setSelectedTaskTypes: (_sidebar, types) => {
            uiCalls.push(['setSelectedTaskTypes', types]);
          },
          setGraphType: (_sidebar, graphType) => {
            uiCalls.push(['setGraphType', graphType]);
          },
          setExpansionState: (_sidebar, expansion) => {
            uiCalls.push(['setExpansionState', expansion]);
          },
          recomputeDataFunnel: () => {
            uiCalls.push(['recomputeDataFunnel']);
          },
          requestSidebarUpdate: () => {
            uiCalls.push(['requestSidebarUpdate']);
          },
        },
      });

      mockSidebar.availableTaskTypes = ['Epic', 'Task'];
      mockViewService.isTypeVisible = (type) => type === 'Epic';

      const mockViewData = {
        id: 'test-view-ui-adapter',
        name: 'Test View UI Adapter',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {
          graphType: 'team',
          expandParentChild: true,
          expandRelations: true,
          expandTeamAllocated: false,
        },
      };

      dataService.getView = async () => mockViewData;

      await serviceWithUiAdapter.loadAndApplyView('test-view-ui-adapter');

      expect(uiCalls.some((call) => call[0] === 'setSelectedTaskTypes')).to.equal(true);
      expect(uiCalls.some((call) => call[0] === 'setGraphType' && call[1] === 'team')).to.equal(
        true
      );
      expect(uiCalls.some((call) => call[0] === 'setExpansionState')).to.equal(true);
    });

    it('should route view events through the event gateway when provided', async () => {
      const eventCalls = [];
      const serviceWithEventGateway = new ViewManagementService(
        mockBus,
        mockState,
        mockViewService,
        {
          events: {
            emitViewsList: (_bus, payload) => {
              eventCalls.push(['emitViewsList', payload]);
            },
            emitViewActivated: (_bus, payload) => {
              eventCalls.push(['emitViewActivated', payload]);
            },
            emitFilterChanged: (_bus, payload) => {
              eventCalls.push(['emitFilterChanged', payload]);
            },
          },
        }
      );

      serviceWithEventGateway.initDefaultView();
      serviceWithEventGateway._views = [{ id: 'view-1' }];
      serviceWithEventGateway._emitViewsList();
      serviceWithEventGateway.clearActiveView();
      serviceWithEventGateway._applyViewOptionsRestore({
        selectedTaskTypes: ['Epic'],
        expansion: {
          expandParentChild: true,
          expandRelations: false,
          expandTeamAllocated: true,
        },
        emitExpansionFilterChange: true,
      });

      expect(eventCalls.some((call) => call[0] === 'emitViewsList')).to.equal(true);
      expect(eventCalls.some((call) => call[0] === 'emitViewActivated')).to.equal(true);
      expect(eventCalls.filter((call) => call[0] === 'emitFilterChanged')).to.have.length(2);
    });

    it('should execute restore without direct sidebar mutation when adapter hooks are provided', async () => {
      const uiCalls = [];
      const frozenSidebar = Object.freeze({
        availableTaskTypes: ['Epic', 'Task'],
      });

      const serviceWithUiAdapter = new ViewManagementService(mockBus, mockState, mockViewService, {
        ui: {
          getSidebarElement: () => frozenSidebar,
          setSelectedTaskTypes: (_sidebar, selectedTaskTypes) => {
            uiCalls.push(['setSelectedTaskTypes', selectedTaskTypes]);
          },
          setGraphType: (_sidebar, graphType) => {
            uiCalls.push(['setGraphType', graphType]);
          },
          setExpansionState: (_sidebar, expansion) => {
            uiCalls.push(['setExpansionState', expansion]);
          },
          recomputeDataFunnel: () => {
            uiCalls.push(['recomputeDataFunnel']);
          },
          requestSidebarUpdate: () => {
            uiCalls.push(['requestSidebarUpdate']);
          },
        },
      });

      mockViewService.isTypeVisible = (type) => type === 'Task';

      dataService.getView = async () => ({
        id: 'test-view-no-direct-sidebar-mutation',
        name: 'No Direct Sidebar Mutation',
        selectedProjects: {},
        selectedTeams: {},
        viewOptions: {
          graphType: 'team',
          expandParentChild: true,
          expandRelations: false,
          expandTeamAllocated: true,
        },
      });

      await serviceWithUiAdapter.loadAndApplyView('test-view-no-direct-sidebar-mutation');

      expect(uiCalls.some((call) => call[0] === 'setSelectedTaskTypes')).to.equal(true);
      expect(uiCalls.some((call) => call[0] === 'setGraphType')).to.equal(true);
      expect(uiCalls.some((call) => call[0] === 'setExpansionState')).to.equal(true);
      expect(uiCalls.some((call) => call[0] === 'requestSidebarUpdate')).to.equal(true);
    });
  });
});
