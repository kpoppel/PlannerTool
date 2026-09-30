/**
 * PluginPlanHealth - Lifecycle wrapper for plan health checks and validation.
 * Migrated to MountedPlugin pattern — replaces manual element creation/mounting.
 */
import { MountedPlugin } from './MountedPlugin.js';

export class PluginPlanHealth extends MountedPlugin {
  static get defaultId() { return 'plugin-plan-health'; }

  constructor(id = PluginPlanHealth.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-plan-health'; }
  get componentPath() { return './PluginPlanHealthComponent.js'; }
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

export default PluginPlanHealth;
