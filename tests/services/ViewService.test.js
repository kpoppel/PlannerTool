/**
 * Unit tests for ViewService
 * Tests view state management, event emission, and state capture/restore
 */

import { expect } from '@esm-bundle/chai';
import { state } from '../../www/js/services/State.js';
import { 
  TimelineEvents, 
  FilterEvents, 
  ViewEvents, 
  FeatureEvents 
} from '../../www/js/core/EventRegistry.js';

describe('ViewService', () => {
  let mockBus;
  let viewService;
  let emitCalls;
  
  beforeEach(() => {
    emitCalls = [];
    mockBus = {
      emit: (event, data) => {
        emitCalls.push({ event, data });
      }
    };
    // Use the singleton view service created by State to avoid circular import
    viewService = state._viewService;
    // Override the bus so emits are captured locally
    viewService.bus = mockBus;
    // Reset internals to defaults to avoid test cross-contamination
    viewService._timelineScale = 'months';
    viewService._showEpics = true;
    viewService._showFeatures = true;
    viewService._showDependencies = false;
    viewService._showUnassignedCards = true;
    viewService._showUnplannedWork = true;
    viewService._condensedCards = false;
    viewService._capacityViewMode = 'team';
    viewService._featureSortMode = 'rank';
  });
  
  describe('Initialization', () => {
    it('should initialize with default values', () => {
      expect(viewService.timelineScale).to.equal('months');
      expect(viewService.showEpics).to.equal(true);
      expect(viewService.showFeatures).to.equal(true);
      expect(viewService.showDependencies).to.equal(false);
      expect(viewService.condensedCards).to.equal(false);
      expect(viewService.capacityViewMode).to.equal('team');
      expect(viewService.featureSortMode).to.equal('rank');
    });
  });
  
  describe('Timeline Scale', () => {
    it('should update timeline scale to weeks', () => {
      viewService.setTimelineScale('weeks');
      expect(viewService.timelineScale).to.equal('weeks');
    });
    
    it('should update timeline scale to quarters', () => {
      viewService.setTimelineScale('quarters');
      expect(viewService.timelineScale).to.equal('quarters');
    });
    
    it('should update timeline scale to years', () => {
      viewService.setTimelineScale('years');
      expect(viewService.timelineScale).to.equal('years');
    });
    
    it('should support all 4 zoom levels', () => {
      const scales = ['weeks', 'months', 'quarters', 'years'];
      scales.forEach(scale => {
        viewService.setTimelineScale(scale);
        expect(viewService.timelineScale).to.equal(scale);
      });
    });
    
    it('should emit SCALE_CHANGED event with payload', () => {
      emitCalls = [];
      viewService.setTimelineScale('quarters');
      const scaleEvent = emitCalls.find(call => call.event === TimelineEvents.SCALE_CHANGED);
      expect(scaleEvent).to.exist;
      expect(scaleEvent.data).to.be.an('object');
      expect(scaleEvent.data.scale).to.equal('quarters');
    });
    
    it('should emit monthWidth with SCALE_CHANGED event', () => {
      emitCalls = [];
      viewService.setTimelineScale('weeks');
      const scaleEvent = emitCalls.find(call => call.event === TimelineEvents.SCALE_CHANGED);
      expect(scaleEvent).to.exist;
      expect(scaleEvent.data.monthWidth).to.equal(240); // weeks = 240px
    });
    
    it('should emit correct monthWidth for each scale', () => {
      const expectedWidths = { weeks: 240, months: 120, quarters: 60, years: 30 };
      Object.entries(expectedWidths).forEach(([scale, width]) => {
        emitCalls = [];
        // Ensure internal scale differs so setTimelineScale will emit
        viewService._timelineScale = (scale === 'weeks') ? 'months' : 'weeks';
        viewService.setTimelineScale(scale);
        const scaleEvent = emitCalls.find(call => call.event === TimelineEvents.SCALE_CHANGED);
        expect(scaleEvent).to.exist;
        expect(scaleEvent.data.monthWidth).to.equal(width);
      });
    });
    
    it('should validate scale and default to months on invalid input', () => {
      viewService.setTimelineScale('invalid-scale');
      expect(viewService.timelineScale).to.equal('months');
    });
    
    it('should not emit event if scale unchanged', () => {
      emitCalls = [];
      viewService.setTimelineScale('months');
      expect(emitCalls.length).to.equal(0);
    });
  });
  
  describe('Visibility Toggles', () => {
    it('should toggle showEpics', () => {
      viewService.setShowEpics(false);
      expect(viewService.showEpics).to.equal(false);
    });
    
    it('should emit FilterEvents.CHANGED when toggling epics', () => {
      emitCalls = [];
      viewService.setShowEpics(false);
      expect(emitCalls.some(call => call.event === FilterEvents.CHANGED)).to.equal(true);
    });
    
    it('should emit FeatureEvents.UPDATED when toggling epics', () => {
      emitCalls = [];
      viewService.setShowEpics(false);
      expect(emitCalls.some(call => call.event === FeatureEvents.UPDATED)).to.equal(true);
    });
    
    it('should toggle showFeatures', () => {
      viewService.setShowFeatures(false);
      expect(viewService.showFeatures).to.equal(false);
    });
    
    it('should toggle showDependencies', () => {
      viewService.setShowDependencies(true);
      expect(viewService.showDependencies).to.equal(true);
    });
    
    it('should emit ViewEvents.DEPENDENCIES when toggling dependencies', () => {
      emitCalls = [];
      viewService.setShowDependencies(true);
      expect(emitCalls.some(call => call.event === ViewEvents.DEPENDENCIES)).to.equal(true);
    });
  });
  
  describe('Display Modes', () => {
    it('should toggle condensedCards', () => {
      viewService.setCondensedCards(true);
      expect(viewService.condensedCards).to.equal(true);
    });
    
    it('should emit ViewEvents.CONDENSED when toggling', () => {
      emitCalls = [];
      viewService.setCondensedCards(true);
      expect(emitCalls.some(call => call.event === ViewEvents.CONDENSED)).to.equal(true);
    });
    
    it('should set capacity view mode', () => {
      viewService.setCapacityViewMode('project');
      expect(viewService.capacityViewMode).to.equal('project');
    });
    
    it('should emit ViewEvents.CAPACITY_MODE when changing mode', () => {
      emitCalls = [];
      viewService._capacityViewMode = 'team';
      emitCalls = [];
      viewService.setCapacityViewMode('project');
      expect(emitCalls.some(call => call.event === ViewEvents.CAPACITY_MODE)).to.equal(true);
    });
    
    it('should reject invalid capacity view modes', () => {
      viewService.setCapacityViewMode('invalid');
      expect(viewService.capacityViewMode).to.equal('team'); // Unchanged
    });
    
    it('should set feature sort mode', () => {
      viewService.setFeatureSortMode('date');
      expect(viewService.featureSortMode).to.equal('date');
    });
    
    it('should emit ViewEvents.SORT_MODE when changing mode', () => {
      emitCalls = [];
      viewService._featureSortMode = 'rank';
      viewService.setFeatureSortMode('date');
      expect(emitCalls.some(call => call.event === ViewEvents.SORT_MODE)).to.equal(true);
    });
    
    it('should reject invalid sort modes', () => {
      viewService.setFeatureSortMode('invalid');
      expect(viewService.featureSortMode).to.equal('rank'); // Unchanged
    });
  });
  
  describe('State Capture and Restore', () => {
    it('should capture current view state including timeline scale', () => {
      viewService.setCapacityViewMode('project');
      viewService.setCondensedCards(true);
      viewService.setFeatureSortMode('date');
      viewService.setTimelineScale('quarters');
      
      const snapshot = viewService.captureCurrentView();
      
      expect(snapshot).to.deep.equal({
        capacityViewMode: 'project',
        condensedCards: true,
        featureSortMode: 'date',
        showUnassignedCards: true,
        showUnplannedWork: true,
        timelineScale: 'quarters'
      });
    });
    
    it('should restore view state from snapshot including timeline scale', () => {
      const snapshot = {
        capacityViewMode: 'project',
        condensedCards: true,
        featureSortMode: 'date',
        showUnassignedCards: false,
        timelineScale: 'weeks'
      };
      
      viewService.restoreView(snapshot);
      
      expect(viewService.capacityViewMode).to.equal('project');
      expect(viewService.condensedCards).to.equal(true);
      expect(viewService.featureSortMode).to.equal('date');
      expect(viewService.showUnassignedCards).to.equal(false);
      expect(viewService.timelineScale).to.equal('weeks');
    });
    
    it('should handle null snapshot gracefully', () => {
      // Ensure starting default
      viewService._capacityViewMode = 'team';
      viewService.restoreView(null);
      // Should not throw, state unchanged
      expect(viewService.capacityViewMode).to.equal('team');
    });
    
    it('should handle partial snapshot', () => {
      viewService._capacityViewMode = 'team';
      viewService.restoreView({ condensedCards: true });
      expect(viewService.condensedCards).to.equal(true);
      expect(viewService.capacityViewMode).to.equal('team'); // Unchanged
    });
  });
  
  describe('Event Emission', () => {
    it('should emit multiple events for view changes', () => {
      emitCalls = [];
      
      viewService.setCondensedCards(true);
      
      expect(emitCalls.length).to.equal(2);
      expect(emitCalls.some(call => call.event === ViewEvents.CONDENSED)).to.equal(true);
      expect(emitCalls.some(call => call.event === FeatureEvents.UPDATED)).to.equal(true);
    });
  });
});
