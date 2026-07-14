/**
 * PluginDependencies.js
 * Lifecycle wrapper for the Dependencies SVG overlay plugin.
 *
 * This plugin auto-activates at startup (activated: true in modules.config.json)
 * to replace the former initDependencyRenderer() call in app.js.
 * The overlay content is toggled by ViewEvents.DEPENDENCIES from the sidebar.
 */
class PluginDependencies {
  constructor(id = 'plugin-dependencies', config = {}) {
    this.id = id;
    this.config = config;
    this._el = null;
    this._componentLoaded = false;
    this.active = false;
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

  async init() {
    if (!this._componentLoaded) {
      await import('./PluginDependenciesComponent.js');
      this._componentLoaded = true;
    }
  }

  async activate() {
    if (!this._componentLoaded) await this.init();

    if (!this._el) {
      this._el = document.createElement('plugin-dependencies');
      this._el.api = this.api;
      document.body.appendChild(this._el);
    }

    // Sync state flag silently to avoid circular event before overlay is ready
    this.api.view.setShowDependencies(true);
    if (this._el?.open) this._el.open();
    this.active = true;
  }

  async deactivate() {
    this.api.view.setShowDependencies(false);
    if (this._el?.close) this._el.close();
    this.active = false;
  }

  async destroy() {
    this._el?.remove();
    this._el = null;
    this.active = false;
  }

  toggle() {
    return this.active ? this.deactivate() : this.activate();
  }
}

export default PluginDependencies;
