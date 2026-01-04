/**
 * Integration tests for Service Composition
 * Tests how ViewService, ColorService, ConfigService, and StateFilterService work together
 */

import { expect } from '@esm-bundle/chai';
import { ViewService } from '../../www/js/services/ViewService.js';
import { ColorService } from '../../www/js/services/ColorService.js';
import { ConfigService } from '../../www/js/services/ConfigService.js';
import { StateFilterService } from '../../www/js/services/StateFilterService.js';
import { 
  ViewEvents, 
  FilterEvents, 
  FeatureEvents, 
  ConfigEvents,
  StateFilterEvents
} from '../../www/js/core/EventRegistry.js';

describe('Service Integration Tests', () => {
  let mockBus;
  let mockDataService;
  let viewService;
  let colorService;
  let configService;
  let stateFilterService;
  let emitCalls;
  
  beforeEach(() => {
    emitCalls = [];
    mockBus = {
      emit: (event, data) => {
        emitCalls.push({ event, data });
      },
      on: (event, handler) => {}
    };
    mockDataService = {
      getColorMappings: async () => ({
        projectColors: {},
        teamColors: {}
      }),
      saveProjectColor: async (id, color) => {},
      saveTeamColor: async (id, color) => {},
      getLocalPref: async () => null,
      setLocalPref: async () => undefined
    };
    
    viewService = new ViewService(mockBus);
    colorService = new ColorService(mockDataService);
    configService = new ConfigService(mockBus, mockDataService);
    stateFilterService = new StateFilterService(mockBus);
  });
  
  afterEach(() => {
    if (configService && configService._autosaveTimer) {
      clearInterval(configService._autosaveTimer);
      configService._autosaveTimer = null;
    }
  });
  
  describe('Event Chain Integration', () => {
    it('should emit correct events when view changes affect features', () => {
      emitCalls = [];
      viewService.setShowEpics(false);
      
      // Should emit both FilterEvents.CHANGED and FeatureEvents.UPDATED
      expect(emitCalls.some(call => call.event === FilterEvents.CHANGED)).to.equal(true);
      expect(emitCalls.some(call => call.event === FeatureEvents.UPDATED)).to.equal(true);
    });
    
    it('should emit correct events when state filter changes', () => {
      stateFilterService.setAvailableStates(['New', 'In Progress', 'Done']);
      emitCalls = [];
      
      stateFilterService.toggleStateSelected('New');
      
      // Should emit FilterEvents.CHANGED and FeatureEvents.UPDATED
      expect(emitCalls.some(call => call.event === FilterEvents.CHANGED)).to.equal(true);
      expect(emitCalls.some(call => call.event === FeatureEvents.UPDATED)).to.equal(true);
    });
    
    it('should emit config events when autosave changes', () => {
      emitCalls = [];
      configService.setupAutosave(5, () => {});
      
      expect(emitCalls.some(call => call.event === ConfigEvents.AUTOSAVE)).to.equal(true);
      expect(emitCalls.some(call => call.data.autosaveInterval === 5)).to.equal(true);
    });
  });
  
  describe('State Capture and Restore', () => {
    it('should capture and restore view state correctly', () => {
      // Set up initial state
      viewService.setCapacityViewMode('project');
      viewService.setCondensedCards(true);
      viewService.setFeatureSortMode('date');
      
      // Capture state
      const viewSnapshot = viewService.captureCurrentView();
      
      // Change state
      viewService.setCapacityViewMode('team');
      viewService.setCondensedCards(false);
      
      // Restore state
      viewService.restoreView(viewSnapshot);
      
      // Should be back to initial state
      expect(viewService.capacityViewMode).to.equal('project');
      expect(viewService.condensedCards).to.equal(true);
      expect(viewService.featureSortMode).to.equal('date');
    });
    
    it('should capture and restore state filter correctly', () => {
      // Set up initial state
      stateFilterService.setAvailableStates(['New', 'In Progress', 'Done']);
      stateFilterService.toggleStateSelected('New');
      
      // Capture state
      const filterSnapshot = {
        availableStates: stateFilterService.availableFeatureStates,
        selectedStates: Array.from(stateFilterService.selectedFeatureStateFilter)
      };
      
      // Change state
      stateFilterService.setAllStatesSelected(false);
      expect(stateFilterService.selectedFeatureStateFilter.size).to.equal(0);
      
      // Restore state by directly setting the private property
      stateFilterService._selectedFeatureStateFilter = new Set(filterSnapshot.selectedStates);
      
      // Should be back to initial state
      expect(stateFilterService.selectedFeatureStateFilter.size).to.equal(2);
      expect(stateFilterService.selectedFeatureStateFilter.has('In Progress')).to.equal(true);
      expect(stateFilterService.selectedFeatureStateFilter.has('Done')).to.equal(true);
    });
  });
  
  describe('Color Service Independence', () => {
    it('should manage colors independently of other services', async () => {
      const projects = [
        { id: 'proj-1', name: 'Project 1' },
        { id: 'proj-2', name: 'Project 2' }
      ];
      
      await colorService.initColors(projects, []);
      
      // Colors should be assigned
      expect(projects[0].color).to.exist;
      expect(projects[1].color).to.exist;
      
      // Should be deterministic
      const color1 = colorService.getProjectColor('proj-1');
      const color2 = colorService.getProjectColor('proj-1');
      expect(color1).to.equal(color2);
    });
    
    it('should provide feature state colors independently', () => {
      const states = ['New', 'In Progress', 'Done'];
      const colors = colorService.getFeatureStateColors(states);
      
      expect(colors['New']).to.exist;
      expect(colors['In Progress']).to.exist;
      expect(colors['Done']).to.exist;
      
      // Each should have background and text colors
      expect(colors['New'].background).to.exist;
      expect(colors['New'].text).to.exist;
    });
  });
  
  describe('Config Service Coordination', () => {
    it('should manage autosave without affecting other services', () => {
      const callback = () => {};
      
      // Enable autosave
      configService.setupAutosave(5, callback);
      
      // ViewService state should be unaffected
      expect(viewService.timelineScale).to.equal('months');
      expect(viewService.showEpics).to.equal(true);
      
      // StateFilterService should be unaffected
      expect(stateFilterService.availableFeatureStates.length).to.equal(0);
    });
    
    it('should manage preferences independently', async () => {
      let storedKey = null;
      let storedValue = null;
      
      mockDataService.setLocalPref = async (key, value) => {
        storedKey = key;
        storedValue = value;
      };
      
      await configService.setLocalPref('test.key', 'test-value');
      
      expect(storedKey).to.equal('test.key');
      expect(storedValue).to.equal('test-value');
    });
  });
  
  describe('Service Boundary Testing', () => {
    it('should maintain separate event namespaces', () => {
      emitCalls = [];
      
      // Trigger events from different services
      viewService.setShowEpics(false);
      stateFilterService.setAvailableStates(['New']);
      configService.setupAutosave(5, () => {});
      
      // Should have events from all three services
      const viewEventCount = emitCalls.filter(call => 
        call.event === ViewEvents.CONDENSED || 
        call.event === FilterEvents.CHANGED ||
        call.event === FeatureEvents.UPDATED
      ).length;
      
      const stateFilterEventCount = emitCalls.filter(call => 
        call.event === StateFilterEvents.CHANGED
      ).length;
      
      const configEventCount = emitCalls.filter(call => 
        call.event === ConfigEvents.AUTOSAVE
      ).length;
      
      expect(viewEventCount).to.be.greaterThan(0);
      expect(stateFilterEventCount).to.be.greaterThan(0);
      expect(configEventCount).to.be.greaterThan(0);
    });
  });
});
