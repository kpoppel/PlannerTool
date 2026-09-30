import { MenuPlugin } from './MenuPlugin.js';

export class SampleMenuPlugin extends MenuPlugin {
  static get defaultId() { return 'sample-menu-plugin'; }

  constructor(id = SampleMenuPlugin.defaultId, config = {}) {
    super(id, config);
    this.counter = 0;
  }

  async init() {
    await import('./SampleMenuPluginComponent.lit.js');
    const custom = this.config.custom_config;
    this.initialCount = custom && typeof custom.initialCount === 'number' ? custom.initialCount : 0;
    this.counter = this.initialCount;
  }

  createMenuElement() {
    const Component = customElements.get('sample-menu-plugin-content');
    if (!Component) throw new Error(`Menu plugin ${this.id} is not initialized`);
    return new Component(this);
  }
}

export default SampleMenuPlugin;