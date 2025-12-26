import { pluginManager } from '../core/PluginManager.js';
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginGraphPlugin {
  constructor(id, opts){
    this.id = id || 'plugin-graph';
    this.config = opts || {};
    this._el = null;
    this._host = null;
    this._componentLoaded = false;
    this.initialized = false;
    this.active = false;
  }

  getMetadata(){
    return {
      id: this.id,
      title: this.config.title || 'Plugin Graph',
      description: this.config.description || 'Large mountain-view graph',
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
    this._host = document.querySelector('main') || document.body;
    this.initialized = true;
  }

  async activate(){
    if(!this._componentLoaded) await this.init();
    if(!this._host) this._host = document.querySelector('main') || document.body;
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
    if(!this._el || this._el.style.display === 'none') this.activate(); else this.deactivate();
  }
}

export async function createAndRegister(opts = {}){
  const id = opts.id || 'plugin-graph';
  const plugin = new PluginGraphPlugin(id, opts);
  await pluginManager.register(plugin);
  return plugin;
}
