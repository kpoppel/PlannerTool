/**
 * PluginPortfolio - Portfolio Board plugin extending FullscreenPlugin.
 * Lifecycle boilerplate delegated to base classes; only component tag and path remain here.
 */
import { FullscreenPlugin } from './FullscreenPlugin.js';

export class PluginPortfolio extends FullscreenPlugin {
  static get defaultId() { return 'plugin-portfolio-board'; }

  constructor(id = PluginPortfolio.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-portfolio-board'; }
  get componentPath() { return './PluginPortfolioComponent.lit.js'; }
  get mountSelector() { return this.config.mountPoint || 'app'; }

  async activate() {
    await super.activate();
    if (typeof this._el.open === 'function') this._el.open();
  }

}

export default PluginPortfolio;
