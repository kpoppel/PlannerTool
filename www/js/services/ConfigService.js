/**
 * Module: ConfigService
 * Intent: Manage application configuration and preferences (autosave, local settings)
 * Purpose: Extract configuration management from State.js for better separation of concerns
 * 
 * Responsibilities:
 * - Manage autosave configuration and timer (single source of truth)
 * - Load/save local preferences via dataService
 * - Provide configuration getters/setters
 * - Listen for external configuration changes and update internal state
 * 
 * Architecture:
 * - ConfigService owns the autosave timer and interval state
 * - External components (UI) emit ConfigEvents.AUTOSAVE to request changes
 * - ConfigService listens to its own events and updates state (preventing circular loops)
 * - State.js registers a callback for autosave actions but doesn't manage the timer
 * 
 * Events listened to:
 * - ConfigEvents.AUTOSAVE: when external sources request autosave interval change
 * 
 * Events emitted:
 * - ConfigEvents.AUTOSAVE: when autosave interval changes (only on initial setup, not on updates)
 */

import { ConfigEvents } from '../core/EventRegistry.js';

export class ConfigService {
  /**
   * Create a new ConfigService
   * @param {EventBus} bus - Event bus for emitting config changes
   * @param {Object} dataService - Data service for loading/saving preferences
   */
  constructor(bus, dataService) {
    this.bus = bus;
    this.dataService = dataService;
    
    // Autosave state
    this._autosaveTimer = null;
    this._autosaveIntervalMin = 0;
    this._autosaveCallback = null;
    
    // Listen for external autosave configuration changes (e.g., from UI)
    bus.on(ConfigEvents.AUTOSAVE, ({ autosaveInterval }) => {
      // Update our internal state if the interval actually changed
      if (autosaveInterval !== this._autosaveIntervalMin) {
        console.debug(`[ConfigService] External autosave update: ${autosaveInterval} minutes`);
        // Update timer with existing callback, silent to avoid re-emitting
        this.setupAutosave(autosaveInterval, this._autosaveCallback, true);
      }
    });
    
    // Initialize autosave from local preferences
    this._initAutosave();
  }
  
  // ========== Autosave Management ==========
  
  /**
   * Initialize autosave from local preferences
   * @private
   */
  async _initAutosave() {
    try {
      const initialAutosave = await this.dataService.getLocalPref('autosave.interval');
      if (initialAutosave && initialAutosave > 0) {
        this.setupAutosave(initialAutosave);
      }
    } catch (err) {
      console.warn('[ConfigService] Failed to load autosave preference:', err);
    }
  }
  
  /**
   * Get current autosave interval
   * @returns {number} Interval in minutes (0 = disabled)
   */
  get autosaveIntervalMin() {
    return this._autosaveIntervalMin;
  }
  
  /**
   * Set up autosave with given interval
   * @param {number} intervalMin - Interval in minutes (0 to disable)
   * @param {Function} autosaveCallback - Callback to execute on autosave tick
   * @param {boolean} silent - If true, don't emit event (used for external updates)
   */
  setupAutosave(intervalMin, autosaveCallback = null, silent = false) {
    // Clear existing timer
    if (this._autosaveTimer) {
      clearInterval(this._autosaveTimer);
      this._autosaveTimer = null;
    }
    
    this._autosaveIntervalMin = intervalMin;
    this._autosaveCallback = autosaveCallback || this._autosaveCallback;
    
    // Set up new timer if interval > 0 and callback exists
    if (intervalMin > 0 && this._autosaveCallback) {
      this._autosaveTimer = setInterval(() => {
        console.debug('[ConfigService] Autosave tick');
        this._autosaveCallback();
      }, intervalMin * 60 * 1000);
      
      console.log(`[ConfigService] Autosave enabled: ${intervalMin} minutes`);
    } else if (intervalMin > 0) {
      console.warn('[ConfigService] Autosave enabled but no callback provided');
    } else {
      console.log('[ConfigService] Autosave disabled');
    }
    
    // Emit configuration change event (unless silent)
    if (!silent) {
      this.bus.emit(ConfigEvents.AUTOSAVE, { autosaveInterval: intervalMin });
    }
  }
  
  /**
   * Update autosave interval from external source (e.g., UI)
   * This method should be called when autosave config changes from outside
   * @param {number} intervalMin - New interval in minutes
   */
  updateAutosaveInterval(intervalMin) {
    // Update the timer with existing callback, and emit event
    this.setupAutosave(intervalMin, this._autosaveCallback, false);
  }
  
  /**
   * Check if autosave is enabled
   * @returns {boolean}
   */
  isAutosaveEnabled() {
    return this._autosaveIntervalMin > 0;
  }
  
  /**
   * Disable autosave
   */
  disableAutosave() {
    this.setupAutosave(0);
  }
  
  // ========== Local Preferences ==========
  
  /**
   * Get a local preference value
   * @param {string} key - Preference key
   * @returns {Promise<any>} Preference value
   */
  async getLocalPref(key) {
    return this.dataService.getLocalPref(key);
  }
  
  /**
   * Set a local preference value
   * @param {string} key - Preference key
   * @param {any} value - Preference value
   * @returns {Promise<void>}
   */
  async setLocalPref(key, value) {
    return this.dataService.setLocalPref(key, value);
  }
  
  // ========== Cleanup ==========
  
  /**
   * Cleanup resources (clear autosave timer)
   * Call this when shutting down the service
   */
  destroy() {
    if (this._autosaveTimer) {
      clearInterval(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  }
}
