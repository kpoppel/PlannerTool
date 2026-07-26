/**
 * PluginCost - Cost analysis plugin extending FullscreenPlugin.
 * Handles three-view cost analysis (Project, Task, Team) with monthly
 * cost/hours breakdowns. All mount-point resolution and timeline-board
 * toggling are delegated to FullscreenPlugin → MountedPlugin base classes.
 */
import { FullscreenPlugin } from './FullscreenPlugin.js';
import { state } from '../services/State.js';

export class PluginCost extends FullscreenPlugin {
  static get defaultId() { return 'plugin-cost'; }

  constructor(id = PluginCost.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-cost'; }
  get componentPath() { return './PluginCostComponent.js'; }
  get mountSelector() { return this.config.mountPoint || 'app'; }

  async activate() {
    await super.activate();
    // Persist pluginId on element
    if (this._el) this._el.pluginId = this.id;
    // Restore persisted date range before opening
    const ps = state.pluginStateService.get(this.id) || {};
    if (ps.startDate) this._el.startDate = ps.startDate;
    if (ps.endDate) this._el.endDate = ps.endDate;
    if (typeof this._el.open === 'function') this._el.open();
  }

  async deactivate() {
    // Persist the currently-selected date range before closing
    const s = { startDate: this._el?.startDate, endDate: this._el?.endDate };
    state.pluginStateService.set(this.id, s, { saveToView: true });
    await super.deactivate();
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Cost Analysis',
      description: this.config.description || 'Three-view cost analysis with project, task, and team breakdowns',
      icon: this.config.icon || 'assessment',
      section: 'tools',
      autoActivate: false,
      fullscreen: true,
    };
  }
}

export default PluginCost;