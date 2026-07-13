/**
 * PluginPlanHealth - Lifecycle wrapper for plan health checks and validation
 */
import { OverlayPlugin } from './OverlayPlugin.js';

class PluginPlanHealth extends OverlayPlugin {
  constructor(id = 'plugin-plan-health', config = {}) {
    super(id, config, {
      tagName: 'plugin-plan-health',
      loadComponent: () => import('./PluginPlanHealthComponent.js'),
    });
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Plan Health',
      description: 'Detect and highlight planning issues and anomalies',
      icon: 'heartbeat',
      section: 'tools',
      autoActivate: false,
    };
  }
}

export default PluginPlanHealth;
