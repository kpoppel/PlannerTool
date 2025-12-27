import { pluginManager } from '../core/PluginManager.js';
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';

class PluginCostPlugin {
  constructor(id, opts){
    this.id = id || 'plugin-cost';
    this.config = opts || {};
    this._el = null;
    this._host = null;
    this._componentLoaded = false;
    this.initialized = false;
    this.active = false;
    this._costData = null;
  }

  getMetadata(){
    return {
      id: this.id,
      title: this.config.title || 'Plugin Cost',
      description: this.config.description || 'Cost analysis plugin',
      icon: this.config.icon || 'attach_money',
      section: 'tools',
      autoActivate: false
    };
  }

  async init(){
    if(!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if(!this._componentLoaded){
      await import('./PluginCostComponent.js');
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
      this._el = document.createElement('plugin-cost');
      this._host.appendChild(this._el);
    }
    // Load cost data from the datasource (no internal fallback here)
    try{
      this._costData = await dataService.getCost();
      console.info(`[${this.id}] Loaded cost data from dataService`);
      if(this._el){ this._el._data = this._costData; try{ this._el.requestUpdate(); }catch(e){} }
    }catch(err){
      console.error(`[${this.id}] Failed to load cost data from dataService`, err);
    }
    if(this._el && typeof this._el.open === 'function') this._el.open(this.config.mode);
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

export default PluginCostPlugin;
