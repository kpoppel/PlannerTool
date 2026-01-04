/**
 * Unit tests for ConfigService
 * Tests autosave configuration and local preferences management
 */

import { expect } from '@esm-bundle/chai';
import { ConfigService } from '../../www/js/services/ConfigService.js';
import { ConfigEvents } from '../../www/js/core/EventRegistry.js';

describe('ConfigService', () => {
  let mockBus;
  let mockDataService;
  let configService;
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
      getLocalPref: async () => null,
      setLocalPref: async () => undefined
    };
    
    configService = new ConfigService(mockBus, mockDataService);
  });
  
  afterEach(() => {
    if (configService && configService._autosaveTimer) {
      clearInterval(configService._autosaveTimer);
      configService._autosaveTimer = null;
    }
  });
  
  describe('Initialization', () => {
    it('should initialize with autosave disabled', () => {
      expect(configService.autosaveIntervalMin).to.equal(0);
      expect(configService.isAutosaveEnabled()).to.equal(false);
    });
  });
  
  describe('Autosave Setup', () => {
    it('should enable autosave with interval', () => {
      const callback = () => {};
      configService.setupAutosave(5, callback);
      
      expect(configService.autosaveIntervalMin).to.equal(5);
      expect(configService.isAutosaveEnabled()).to.equal(true);
    });
    
    it('should emit ConfigEvents.AUTOSAVE when setting up', () => {
      emitCalls = [];
      configService.setupAutosave(5, () => {});
      
      expect(emitCalls.some(call => call.event === ConfigEvents.AUTOSAVE)).to.equal(true);
      expect(emitCalls.some(call => call.data.autosaveInterval === 5)).to.equal(true);
    });
    
    it('should clear existing timer when setting up new interval', () => {
      const callback = () => {};
      
      configService.setupAutosave(5, callback);
      const timer1 = configService._autosaveTimer;
      
      configService.setupAutosave(10, callback);
      const timer2 = configService._autosaveTimer;
      
      expect(timer1).not.to.equal(timer2);
    });
    
    it('should disable autosave with interval 0', () => {
      configService.setupAutosave(5, () => {});
      expect(configService.isAutosaveEnabled()).to.equal(true);
      
      configService.setupAutosave(0);
      expect(configService.isAutosaveEnabled()).to.equal(false);
      expect(configService._autosaveTimer).to.equal(null);
    });
  });
  
  describe('Autosave Disable', () => {
    it('should disable autosave', () => {
      configService.setupAutosave(5, () => {});
      expect(configService.isAutosaveEnabled()).to.equal(true);
      
      configService.disableAutosave();
      
      expect(configService.isAutosaveEnabled()).to.equal(false);
      expect(configService.autosaveIntervalMin).to.equal(0);
    });
    
    it('should emit ConfigEvents.AUTOSAVE when disabling', () => {
      emitCalls = [];
      
      configService.disableAutosave();
      
      expect(emitCalls.some(call => call.event === ConfigEvents.AUTOSAVE)).to.equal(true);
      expect(emitCalls.some(call => call.data.autosaveInterval === 0)).to.equal(true);
    });
  });
  
  describe('Local Preferences', () => {
    it('should get local preference', async () => {
      mockDataService.getLocalPref = async (key) => {
        if (key === 'test.key') return 'test-value';
        return null;
      };
      
      const value = await configService.getLocalPref('test.key');
      
      expect(value).to.equal('test-value');
    });
    
    it('should set local preference', async () => {
      let setKey = null;
      let setValue = null;
      mockDataService.setLocalPref = async (key, value) => {
        setKey = key;
        setValue = value;
      };
      
      await configService.setLocalPref('test.key', 'test-value');
      
      expect(setKey).to.equal('test.key');
      expect(setValue).to.equal('test-value');
    });
  });
  
  describe('Cleanup', () => {
    it('should clear timer when setting interval to 0', () => {
      configService.setupAutosave(5, () => {});
      expect(configService._autosaveTimer).not.to.equal(null);
      
      configService.setupAutosave(0);
      
      expect(configService._autosaveTimer).to.equal(null);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle negative autosave interval', () => {
      configService.setupAutosave(-5);
      
      expect(configService.autosaveIntervalMin).to.equal(-5);
      expect(configService.isAutosaveEnabled()).to.equal(false);
    });
    
    it('should handle autosave setup without callback', () => {
      // Should not throw, autosave still stored
      configService.setupAutosave(5);
      
      expect(configService.autosaveIntervalMin).to.equal(5);
    });
  });
});
