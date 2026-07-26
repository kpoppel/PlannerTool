/**
 * PluginDependencies - Lifecycle wrapper for the Dependencies SVG overlay plugin.
 * Migrated to MountedPlugin pattern — replaces manual element creation/mounting.
 * This plugin auto-activates at startup (activated: true in modules.config.json).
 */
import { MountedPlugin } from './MountedPlugin.js';
import { state } from '../services/State.js';

export class PluginDependencies extends MountedPlugin {
  static get defaultId() { return 'plugin-dependencies'; }

  constructor(id = PluginDependencies.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-dependencies'; }
  get componentPath() { return './PluginDependenciesComponent.js'; }
  get mountSelector() { return '_body'; }

  async activate() {
    await super.activate();
    state.setShowDependencies(true, true);
    if (this._el?.open) this._el.open();
  }

  async deactivate() {
    state.setShowDependencies(false, true);
    if (this._el?.close) this._el.close();
    await super.deactivate();
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Dependencies',
      description: 'Render dependency arrows between feature cards',
      icon: 'account_tree',
      section: 'overlay',
      autoActivate: true,
    };
  }
}

export default PluginDependencies;
