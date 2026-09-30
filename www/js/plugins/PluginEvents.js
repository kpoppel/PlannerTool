/**
 * PluginEvents - Lifecycle wrapper for plan events SVG overlay.
 * Migrated to MountedPlugin pattern — replaces manual element creation/mounting.
 */
import { MountedPlugin } from './MountedPlugin.js';

export class PluginEvents extends MountedPlugin {
  static get defaultId() { return 'plugin-events'; }

  constructor(id = PluginEvents.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-events'; }
  get componentPath() { return './PluginEventsComponent.js'; }
  get mountSelector() { return '_body'; }

  async activate() {
    await super.activate();
    if (this._el?.open) this._el.open();
  }

  async deactivate() {
    if (this._el?.close) this._el.close();
    await super.deactivate();
  }

}

export default PluginEvents;
