/**
 * PluginGraphPlugin
 * Single-responsibility: lifecycle wrapper that mounts the `plugin-graph`
 * component. Delegates rendering and data computation to the component.
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginGraphPlugin {
  constructor(id = 'plugin-graph', config = {}){
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
      name: this.config.name || 'Graph Viewer',
      description: this.config.description || 'Large capacity allocation graph',
      icon: this.config.icon || 'bar_chart',
      section: 'tools',
      autoActivate: false
    };
  }

  async init(){
    if(!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if(!this._componentLoaded){
      await import('./PluginGraphComponent.js');
      this._componentLoaded = true;
    }
    const selector = this.config.mountPoint || 'main';
    this._host = document.querySelector(selector) || document.body;
    this.initialized = true;
  }

  async activate(){
    if(!this._componentLoaded) await this.init();
    if(!this._host){ const selector = this.config.mountPoint || 'main'; this._host = document.querySelector(selector) || document.body; }
    if(!this._el){
      this._el = document.createElement('plugin-graph');
      this._host.appendChild(this._el);
    }
    // Prefer app/state view mode unless this plugin explicitly requests a forced mode
    const modeArg = (this.config && this.config.forceMode) ? (this.config.mode || 'project') : undefined;
    if(this._el && typeof this._el.open === 'function') this._el.open(modeArg);
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

export default PluginGraphPlugin;
