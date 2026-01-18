/**
 * PluginCostPlugin
 * Single-responsibility: lifecycle wrapper that mounts/unmounts the
 * `plugin-cost` component and coordinates initial data loading.
 *
 * Methods are deliberately small; the heavy lifting happens in the
 * component and the `dataService`.
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';

class PluginCostPlugin {
  constructor(id = 'plugin-cost', config = {}){
    this.id = id;
    this.config = config;
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
      name: this.config.name || 'Cost Analysis',
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
    const selector = this.config.mountPoint || 'timeline-board';
    this._host = document.querySelector(selector) || document.body;
    this.initialized = true;
  }

  /**
   * Activate the plugin: ensure component exists, load cost data and open UI.
   * @returns {Promise<void>}
   */

  async activate(){
    if(!this._componentLoaded) await this.init();
    if(!this._host){ const selector = this.config.mountPoint || 'timeline-board'; this._host = document.querySelector(selector) || document.body; }
    if(!this._el){
      this._el = document.createElement('plugin-cost');
      this._host.appendChild(this._el);
    }
    // Open the plugin UI immediately; the component handles its own data
    // loading to avoid blocking the UI and to prevent duplicate fetches.
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
    this.active ? this.deactivate() : this.activate();
  }
}

export default PluginCostPlugin;
