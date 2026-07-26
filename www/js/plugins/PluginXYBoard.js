/**
 * PluginXYBoard - XY Board plugin extending FullscreenPlugin.
 * Lifecycle boilerplate delegated to base classes.
 */
import { FullscreenPlugin } from './FullscreenPlugin.js';

export class PluginXYBoard extends FullscreenPlugin {
  static get defaultId() { return 'plugin-xy-board'; }

  constructor(id = PluginXYBoard.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-xy-board'; }
  get componentPath() { return './PluginXYBoardComponent.lit.js'; }
  get mountSelector() { return this.config.mountPoint || 'app'; }

  async activate() {
    await super.activate();
    if (typeof this._el.open === 'function') this._el.open();
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'XY Board',
      description: this.config.description || 'Display features in an X/Y field intersection table',
      icon: this.config.icon || 'table_chart',
      section: 'tools',
      autoActivate: false,
      fullscreen: true,
    };
  }
}

export default PluginXYBoard;
