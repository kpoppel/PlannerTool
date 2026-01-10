/**
 * PluginAnnotations
 * Lifecycle wrapper for the Annotations plugin
 * Provides SVG annotation tools for the timeline view
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginAnnotations {
  constructor(id = 'plugin-annotations', config = {}) {
    this.id = id;
    this.config = config;
    this._el = null;
    this._host = null;
    this._componentLoaded = false;
    this.initialized = false;
    this.active = false;
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Annotations',
      description: this.config.description || 'Add notes, shapes and lines to the timeline',
      icon: this.config.icon || 'edit_note',
      section: 'tools',
      autoActivate: false
    };
  }

  async init() {
    if (!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if (!this._componentLoaded) {
      await import('./PluginAnnotationsComponent.js');
      this._componentLoaded = true;
    }
    const selector = this.config.mountPoint || 'main';
    this._host = document.querySelector(selector) || document.body;
    this.initialized = true;
  }

  async activate() {
    if (!this._componentLoaded) await this.init();
    if (!this._host) {
      const selector = this.config.mountPoint || 'main';
      this._host = document.querySelector(selector) || document.body;
    }
    if (!this._el) {
      this._el = document.createElement('plugin-annotations');
      this._host.appendChild(this._el);
    }
    if (this._el && typeof this._el.open === 'function') {
      this._el.open();
    }
    this.active = true;
    bus.emit(PluginEvents.ACTIVATED, { id: this.id });
  }

  async deactivate() {
    if (this._el && typeof this._el.close === 'function') {
      this._el.close();
    }
    this.active = false;
    bus.emit(PluginEvents.DEACTIVATED, { id: this.id });
  }

  async destroy() {
    if (this._el && this._el.parentNode) {
      this._el.parentNode.removeChild(this._el);
    }
    this._el = null;
    this.initialized = false;
    this.active = false;
  }

  toggle() {
    this.active ? this.deactivate() : this.activate();
  }
  
  /**
   * Check if annotations plugin is currently active
   * @returns {boolean}
   */
  isActive() {
    return this.active;
  }
  
  /**
   * Get the annotation state for use by other plugins (e.g., Export)
   * @returns {AnnotationState|null}
   */
  getAnnotationState() {
    // Lazy import to avoid circular dependencies
    return import('./annotations/AnnotationState.js').then(mod => mod.getAnnotationState());
  }
}

export default PluginAnnotations;
