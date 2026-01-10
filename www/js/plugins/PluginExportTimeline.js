/**
 * PluginExportTimeline
 * Lifecycle wrapper that mounts a small component providing timeline export
 * functionality. Follows existing plugin patterns used by other plugins.
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginExportTimeline {
  constructor(id = 'plugin-export-timeline', config = {}){
    this.id = id;
    this.config = config;
    this._el = null;
    this._host = null;
    this._componentLoaded = false;
    this.initialized = false;
    this.active = false;
  }

  getMetadata(){
    return {
      id: this.id,
      name: this.config.name || 'Export Timeline',
      description: this.config.description || 'Export timeline data to JSON or CSV',
      icon: this.config.icon || 'file_download',
      section: 'tools',
      autoActivate: false
    };
  }

  async init(){
    if(!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if(!this._componentLoaded){
      await import('./PluginExportTimelineComponent.js');
      this._componentLoaded = true;
    }
    const selector = this.config.mountPoint || 'main';
    this._host = document.querySelector(selector) || document.body;
    this.initialized = true;
  }

  async activate(){
    if(!this._componentLoaded) await this.init();
    if(!this._host){ const selector = this.config.mountPoint || 'main'; this._host = document.querySelector(selector) || document.body; }
    // If element was previously created but removed from DOM, re-append it.
    if (!this._el) {
      this._el = document.createElement('plugin-export-timeline');
    }
    if (this._el && !this._el.parentNode) {
      this._host.appendChild(this._el);
    }
    if (this._el && typeof this._el.open === 'function') {
      this._el.open(this.config.mode);
    }
    this.active = true;
    bus.emit(PluginEvents.ACTIVATED, { id: this.id });
  }

  async deactivate(){
    if(this._el && typeof this._el.close === 'function') this._el.close();
    this.active = false;
    bus.emit(PluginEvents.DEACTIVATED, { id: this.id });
  }

  async destroy(){
    if(this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    this.initialized = false;
    this.active = false;
  }

  toggle(){
    this.active ? this.deactivate() : this.activate();
  }
}

export default PluginExportTimeline;
