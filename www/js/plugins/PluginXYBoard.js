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

}

export default PluginXYBoard;
