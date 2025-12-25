import { Plugin } from '../core/Plugin.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';

export class SamplePlugin extends Plugin {
  constructor(id, config = {}) {
    super(id, config);
    this._boundOnFeatureSelect = this._onFeatureSelect.bind(this);
  }

  async init() {
    // Prepare plugin state
    this.initialized = true;
    console.log(`[SamplePlugin] init ${this.id}`);
  }

  async activate() {
    // Subscribe to a representative event to demonstrate plugin behavior
    bus.on(FeatureEvents.SELECTED, this._boundOnFeatureSelect);
    this.active = true;
    console.log(`[SamplePlugin] activate ${this.id}`);
  }

  async deactivate() {
    bus.off(FeatureEvents.SELECTED, this._boundOnFeatureSelect);
    this.active = false;
    console.log(`[SamplePlugin] deactivate ${this.id}`);
  }

  async destroy() {
    // Ensure listeners cleaned up
    try { bus.off(FeatureEvents.SELECTED, this._boundOnFeatureSelect); } catch (e) {}
    this.initialized = false;
    console.log(`[SamplePlugin] destroy ${this.id}`);
  }

  _onFeatureSelect(payload) {
    console.log(`[SamplePlugin] feature selected:`, payload);
  }
}

export default SamplePlugin;
