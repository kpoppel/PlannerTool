/**
 * PluginMarkers - delivery plan markers overlay extending MountedPlugin.
 * Uses MountedPlugin lifecycle (lazy import → element creation → mount).
 */
import { MountedPlugin } from './MountedPlugin.js';

export class PluginMarkers extends MountedPlugin {
  static get defaultId() { return 'plugin-markers'; }

  constructor(id = PluginMarkers.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-markers'; }
  get componentPath() { return './PluginMarkersComponent.js'; }
  get mountSelector() { return '_body'; } // sentinel → MountedPlugin resolves to document.body

  async activate() {
    await super.activate();
    if (this._el?.open) this._el.open();
  }

  async deactivate() {
    if (this._el?.close) this._el.close();
    await super.deactivate();
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Plan Markers',
      description: 'Display delivery plan markers on timeline',
      icon: 'flag',
      section: 'tools',
      autoActivate: false,
    };
  }
}

export default PluginMarkers;
