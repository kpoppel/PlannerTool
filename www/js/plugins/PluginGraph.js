/**
 * PluginGraph - Graph Viewer plugin extending FullscreenPlugin.
 * Lifecycle boilerplate delegated to base classes; only component tag, path remain here.
 */
import { FullscreenPlugin } from './FullscreenPlugin.js';

export class PluginGraph extends FullscreenPlugin {
  static get defaultId() { return 'plugin-graph'; }

  constructor(id = PluginGraph.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-graph'; }
  get componentPath() { return './PluginGraphComponent.js'; }
  get mountSelector() { return this.config.mountPoint || 'app'; }

  async activate() {
    await super.activate();
    if (typeof this._el.open === 'function') this._el.open();
  }

}

export default PluginGraph;
