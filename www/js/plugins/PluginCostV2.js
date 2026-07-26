/**
 * PluginCostV2 - Cost analysis (v2) plugin extending FullscreenPlugin.
 * Lifecycle boilerplate delegated to base classes; only component tag, path,
 * and v2-specific state persistence remain here.
 */
import { FullscreenPlugin } from './FullscreenPlugin.js';
import { state } from '../services/State.js';

export class PluginCostV2 extends FullscreenPlugin {
  static get defaultId() { return 'plugin-cost-v2'; }

  constructor(id = PluginCostV2.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-cost-v2'; }
  get componentPath() { return './PluginCostV2Component.js'; }
  get mountSelector() { return this.config.mountPoint || 'app'; }

  async activate() {
    await super.activate();
    if (this._el) this._el.pluginId = this.id;
    // Restore persisted date range before opening
    const ps = state.pluginStateService.get(this.id) || {};
    if (ps.startDate) this._el.startDate = ps.startDate;
    if (ps.endDate) this._el.endDate = ps.endDate;
    if (typeof this._el.open === 'function') this._el.open();
  }

  async deactivate() {
    // Persist date range before closing
    const s = { startDate: this._el?.startDate, endDate: this._el?.endDate };
    state.pluginStateService.set(this.id, s, { saveToView: true });
    await super.deactivate();
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Cost Analysis (v2)',
      description: this.config.description || 'Three-view cost analysis with project, task, and team breakdowns',
      icon: this.config.icon || 'assessment',
      section: 'tools',
      autoActivate: false,
      fullscreen: true,
    };
  }
}

export default PluginCostV2;
