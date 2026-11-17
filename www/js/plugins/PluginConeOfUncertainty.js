import { FullscreenPlugin } from './FullscreenPlugin.js';

export class PluginConeOfUncertainty extends FullscreenPlugin {
  static get defaultId() { return 'plugin-cone-of-uncertainty'; }

  constructor(id = PluginConeOfUncertainty.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-cone-of-uncertainty'; }
  get componentPath() { return './PluginConeOfUncertaintyComponent.lit.js'; }

  async activate() {
    await super.activate();
    await this._el.open();
  }
}

export default PluginConeOfUncertainty;
