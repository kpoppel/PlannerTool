import { MenuPlugin } from './MenuPlugin.js';

export class PluginReconciliation extends MenuPlugin {
  static get defaultId() { return 'plugin-reconciliation'; }

  constructor(id = PluginReconciliation.defaultId, config = {}) {
    super(id, config);
  }

  async init() {
    await import('./PluginReconciliationComponent.lit.js');
    this.initialized = true;
  }

  createMenuElement() {
    if (!this.initialized) throw new Error(`Menu plugin ${this.id} is not initialized`);
    const Component = customElements.get('plugin-reconciliation-content');
    return new Component();
  }
}

export default PluginReconciliation;