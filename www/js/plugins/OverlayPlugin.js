import { isEnabled } from '../config.js';
import { Plugin } from '../core/Plugin.js';

/**
 * OverlayPlugin
 * Base class for simple DOM-mounted plugin wrappers with open/close lifecycle.
 */
export class OverlayPlugin extends Plugin {
  /**
   * @param {string} id
   * @param {object} config
   * @param {{
   *  tagName: string,
   *  loadComponent: () => Promise<any>,
   *  featureFlag?: string,
   * }} options
   */
  constructor(id, config = {}, options) {
    super(id, config);
    this._el = null;
    this._componentLoaded = false;
    this._tagName = options.tagName;
    this._loadComponent = options.loadComponent;
    this._featureFlag = options.featureFlag || 'USE_PLUGIN_SYSTEM';
  }

  getMountTarget() {
    return document.body;
  }

  async init() {
    if (this._featureFlag && !isEnabled(this._featureFlag)) return;
    if (!this._componentLoaded) {
      await this._loadComponent();
      this._componentLoaded = true;
    }
    this.initialized = true;
  }

  async activate() {
    if (!this._componentLoaded) await this.init();

    if (!this._el) {
      this._el = document.createElement(this._tagName);
      this._el.api = this.api;
      this.getMountTarget().appendChild(this._el);
    }

    this.open();
  }

  open() {
    if (this._el?.open) this._el.open();
    this.active = true;
  }

  async deactivate() {
    this.close();
  }

  close() {
    if (this._el?.close) this._el.close();
    this.active = false;
  }

  async destroy() {
    this._el?.remove();
    this._el = null;
    this.active = false;
    this.initialized = false;
  }

  toggle() {
    return this.active ? this.deactivate() : this.activate();
  }

  async refresh() {
    if (this._el?.refresh) await this._el.refresh();
  }
}

export default OverlayPlugin;
