/**
 * SamplePlugin
 * Minimal example plugin demonstrating lifecycle, event subscription, and custom config.
 * Used as documentation/example of the plugin API and custom configuration pattern.
 * 
 * Custom config schema demonstration:
 * - Exposes admin config editor for sample settings
 * - Runtime behavior reflects admin-configured values
 * - Demonstrates how plugins consume custom_config from runtime config
 * 
 * UI Component:
 * - Displays current custom configuration when activated
 * - Shows enableLogging, sampleSetting, and threshold values
 * - Provides visual feedback that custom_config is being consumed
 */
import { Plugin } from '../core/Plugin.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';

export class SamplePlugin extends Plugin {
  constructor(id, config = {}) {
    super(id, config);
    this._boundOnFeatureSelect = this._onFeatureSelect.bind(this);
    // Runtime config fields (from backend custom_config)
    this._customConfig = config.custom_config || {};
    this._componentLoaded = false;
    this._componentEl = null;
  }

  async init() {
    // Lazy load the component
    if (!this._componentLoaded) {
      try {
        await import('./SamplePluginComponent.lit.js');
        this._componentLoaded = true;
      } catch (err) {
        console.error('SamplePlugin: failed to load component', err);
      }
    }
    // Prepare plugin state
    this.initialized = true;
    this._logMessage(`init ${this.id}`, 'init');
  }

  /**
   * Activate plugin: subscribe to events and show UI component.
   * @returns {Promise<void>}
   */
  async activate() {
    if (!this._componentLoaded) await this.init();
    
    // Subscribe to a representative event to demonstrate plugin behavior
    bus.on(FeatureEvents.SELECTED, this._boundOnFeatureSelect);
    
    // Create and mount the UI component
    if (!this._componentEl) {
      this._componentEl = document.createElement('sample-plugin-component');
      this._componentEl.customConfig = this._customConfig;
      document.body.appendChild(this._componentEl);
    }
    if (this._componentEl.open) this._componentEl.open();
    
    this.active = true;
    this._logMessage(`activate ${this.id}`, 'activate');
  }

  async deactivate() {
    bus.off(FeatureEvents.SELECTED, this._boundOnFeatureSelect);
    
    // Hide the component
    if (this._componentEl && this._componentEl.close) {
      this._componentEl.close();
    }
    
    this.active = false;
    this._logMessage(`deactivate ${this.id}`, 'deactivate');
  }

  async destroy() {
    // Ensure listeners cleaned up
    bus.off(FeatureEvents.SELECTED, this._boundOnFeatureSelect);
    
    // Remove component from DOM
    if (this._componentEl) {
      this._componentEl.remove();
      this._componentEl = null;
    }
    
    this.initialized = false;
    this._logMessage(`destroy ${this.id}`, 'destroy');
  }

  /**
   * Log a message using configured logging level and prefix.
   * Demonstrates runtime consumption of custom_config.
   * 
   * @private
   * @param {string} message - message to log
   * @param {string} level - log level (init, activate, feature-select, etc.)
   */
  _logMessage(message, level = 'info') {
    const enableLogging = this._customConfig.enableLogging ?? false;
    const prefix = this._customConfig.sampleSetting ?? 'Sample';
    
    if (enableLogging) {
      console.log(`[${prefix}] (${level}): ${message}`);
    }
  }

  /**
   * Handle feature select event.
   * Demonstrates visible behavior based on admin-configured custom_config.
   * 
   * @private
   * @param {object} payload - event payload with feature details
   */
  _onFeatureSelect(payload) {
    const threshold = this._customConfig.threshold ?? 50;
    const enableLogging = this._customConfig.enableLogging ?? false;
    
    // Example behavior: log if enabled
    this._logMessage(
      `feature selected: ${payload?.featureId || 'unknown'} (threshold: ${threshold})`,
      'feature-select'
    );
  }

  /**
   * Provide custom configuration schema for admin UI.
   * This method is optional; plugins without schema work unchanged.
   * 
   * @static
   * @returns {Promise<Object>} JSON schema for admin form
   */
  static async getAdminConfigSchema() {
    return {
      type: 'object',
      title: 'Sample Plugin Configuration',
      description: 'Configure behavior of the Sample Plugin. These settings are persisted via the admin panel and affect plugin behavior at runtime.',
      properties: {
        sampleSetting: {
          type: 'string',
          title: 'Log Prefix',
          description: 'Prefix used in console log messages when logging is enabled',
          default: 'Sample',
          minLength: 1,
          maxLength: 50,
        },
        enableLogging: {
          type: 'boolean',
          title: 'Enable Debug Logging',
          description: 'When enabled, the plugin logs lifecycle and event information to the browser console',
          default: false,
        },
        threshold: {
          type: 'number',
          title: 'Feature Threshold',
          description: 'Example numeric threshold used in feature selection behavior',
          minimum: 0,
          maximum: 100,
          default: 50,
        },
      },
      required: [],
    };
  }

  /**
   * Provide default custom configuration.
   * These defaults are used when a plugin is first registered with no persisted config.
   * 
   * @static
   * @returns {Promise<Object>} Default configuration object
   */
  static async getDefaultAdminConfig() {
    return {
      sampleSetting: 'Sample',
      enableLogging: false,
      threshold: 50,
    };
  }
}

export default SamplePlugin;
