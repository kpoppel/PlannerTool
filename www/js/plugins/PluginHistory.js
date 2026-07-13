/**
 * PluginHistory - Lifecycle wrapper for task history overlay
 */
import { OverlayPlugin } from './OverlayPlugin.js';

class PluginHistory extends OverlayPlugin {
  constructor(id = 'plugin-history', config = {}) {
    super(id, config, {
      tagName: 'plugin-history',
      loadComponent: () => import('./PluginHistoryComponent.js'),
    });
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Task History',
      description: 'Display task date change history on timeline',
      icon: 'history',
      section: 'tools',
      autoActivate: false,
    };
  }
}

export default PluginHistory;
