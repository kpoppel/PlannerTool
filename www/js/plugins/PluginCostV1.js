/**
 * PluginCostV1 - Cost analysis (v1) plugin extending FullscreenPlugin.
 * Lifecycle boilerplate delegated to base classes; only component tag, path,
 * and any v1-specific extras remain here.
 */
import { FullscreenPlugin } from './FullscreenPlugin.js';

export class PluginCostV1 extends FullscreenPlugin {
  static get defaultId() { return 'plugin-cost-v1'; }

  constructor(id = PluginCostV1.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-cost-v1'; }
  get componentPath() { return './PluginCostV1Component.js'; }
  get mountSelector() { return this.config.mountPoint || 'app'; }

  async activate() {
    await super.activate();
    if (typeof this._el.open === 'function') this._el.open(this.config.mode);
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Cost Analysis (v1)',
      description: this.config.description || 'Legacy cost analysis plugin',
      icon: this.config.icon || 'attach_money',
      section: 'tools',
      autoActivate: false,
      fullscreen: this.config.fullscreen ?? true,
    };
  }
}

export default PluginCostV1;
