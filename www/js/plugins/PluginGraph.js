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

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Graph Viewer',
      description: this.config.description || 'Large capacity allocation graph',
      icon: this.config.icon || 'bar_chart',
      section: 'tools',
      autoActivate: false,
      fullscreen: true,
    };
  }
}

export default PluginGraph;
