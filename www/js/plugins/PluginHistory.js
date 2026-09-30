/**
 * PluginHistory - Task history plugin using MountedPlugin lifecycle.
 * Uses MountedPlugin for lazy import, element creation, and mounting.
 */
import { MountedPlugin } from './MountedPlugin.js';

export class PluginHistory extends MountedPlugin {
  static get defaultId() { return 'plugin-history'; }

  constructor(id = PluginHistory.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-history'; }
  get componentPath() { return './PluginHistoryComponent.js'; }
  get mountSelector() { return '_body'; } // sentinel → MountedPlugin resolves to document.body

  async activate() {
    await super.activate();
    if (this._el?.open) this._el.open();
  }

  async deactivate() {
    if (this._el?.close) this._el.close();
    await super.deactivate();
  }

}

export default PluginHistory;
