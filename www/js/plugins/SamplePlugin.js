/**
 * SamplePlugin - Minimal example plugin demonstrating lifecycle, event subscription, and custom config.
 * Migrated to MountedPlugin pattern — replaces manual element creation/mounting.
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
 * 
 * === Plugin Developer Guide ===
 * 
 * A MountedPlugin subclass has four required pieces:
 * 1. `componentTag` — the custom element name (e.g., 'my-plugin')
 * 2. `componentPath` — ES module path for dynamic import
 * 3. `mountSelector` — where to append the element ('_body' for floating UI, 'app' for board area)
 * 4. Optional: override `activate()` / `deactivate()` for extras (event subscriptions, state sync, etc.)
 * 
 * The MountedPlugin base class handles:
 * - Lazy component import via dynamic import()
 * - Element creation and DOM mounting with standard fallback resolution
 * - Show/hide via display property toggling
 * - Lifecycle events emitted to the EventBus
 * 
 * For floating panels (most common): use mountSelector = '_body'
 * The element gets appended to document.body, independent of board layout.
 * 
 * For board-mounted plugins: use mountSelector = 'app' (or a specific selector)
 * The element is inserted into the flex container alongside timeline-board.
 * Only use this if you need the element sized relative to the board.
 * 
 * Shadow DOM mounting: override `_ensureElement()` with custom logic.
 */
import { MountedPlugin } from './MountedPlugin.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';
import { sel } from '../application/imports.js';

export class SamplePlugin extends MountedPlugin {
  // Static default ID — used by pluginManager to register and retrieve this plugin
  static get defaultId() { return 'sample-plugin'; }

  constructor(id = SamplePlugin.defaultId, config = {}) {
    super(id, config);
    // Store custom config for runtime access (e.g., logging prefix)
    this._customConfig = config.custom_config || {};
    // Pre-bind event handlers so bus.off() works reliably by reference
    this._boundOnFeatureSelect = this._onFeatureSelect.bind(this);
  }

  // ── Required: tell MountedPlugin what component to load and where to mount it ──

  /** Custom element tag name — must match customElements.define() in the component file */
  get componentTag() { return 'sample-plugin-component'; }

  /** ES module path for dynamic import. MountedPlugin loads this lazily on first activate(). */
  get componentPath() { return './SamplePluginComponent.lit.js'; }

  /** Where to mount: '_body' → document.body (floating panel); 'app' → #app (board area) */
  get mountSelector() { return '_body'; }

  // ── Lifecycle overrides ──

  async activate() {
    // super.activate() handles: component import, element creation, DOM mount, show
    await super.activate();
    
    // Extra: subscribe to bus events (pre-bound handler for reliable cleanup)
    bus.on(FeatureEvents.SELECTED, this._boundOnFeatureSelect);
    
    // Extra: pass custom config to the component element
    if (this._el?.customConfig) this._el.customConfig = this._customConfig;
    
    // Extra: call open() on the component to show its content
    if (this._el?.open) this._el.open();
  }

  async deactivate() {
    // Always clean up event subscriptions — use the same bound reference from constructor
    bus.off(FeatureEvents.SELECTED, this._boundOnFeatureSelect);
    
    // Close the component's content (hides panel, resets state)
    if (this._el?.close) this._el.close();
    
    // super.deactivate() handles: hide element, emit DEACTIVATED event
    await super.deactivate();
  }

  // ── Required: plugin metadata for registration and toolbar display ──
  // Every plugin must implement getMetadata() with id, name, description, icon.

  getMetadata() {
    return {
      id: this.id,
      name: 'Sample Plugin',
      description: 'Example plugin demonstrating lifecycle and custom config',
      icon: 'help',
      section: 'tools',  // toolbar section where this appears (e.g., 'tools', 'overlay')
      autoActivate: false,  // set true to auto-activate on app load
    };
  }

  // ── Custom logic — demonstrates consuming admin-configured values at runtime ──

  /**
   * Log using plugin's configured prefix and enableLogging setting.
   * Shows how custom_config flows from admin panel → constructor → runtime behavior.
   */
  _logMessage(message, level = 'info') {
    const enableLogging = this._customConfig.enableLogging ?? false;
    const prefix = this._customConfig.sampleSetting ?? 'Sample';
    if (enableLogging) {
      console.log(`[${prefix}] (${level}): ${message}`);
    }
  }

  /**
   * Event handler for FeatureEvents.SELECTED.
   * Demonstrates subscribing to bus events in activate() and cleaning up in deactivate().
   * Always store the bound reference in the constructor so bus.off() works by identity.
   */
  _onFeatureSelect() {
    const threshold = this._customConfig.threshold ?? 50;
    const id = sel.feature.getSelectedFeatureId();
    this._logMessage(
      `feature selected: ${id || 'unknown'} (threshold: ${threshold})`,
      'feature-select'
    );
  }

  // ── Optional: admin config schema for the Plugin Manager → plugin entry file.
  // Static methods on the class. The PluginManager reads these to build admin forms.
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

  static async getDefaultAdminConfig() {
    return {
      sampleSetting: 'Sample',
      enableLogging: false,
      threshold: 50,
    };
  }
}

export default SamplePlugin;
