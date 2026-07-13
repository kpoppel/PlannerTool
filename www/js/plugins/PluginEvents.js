/**
 * PluginEvents - Lifecycle wrapper for plan events SVG overlay
 */
import { OverlayPlugin } from './OverlayPlugin.js';

class PluginEventsPlugin extends OverlayPlugin {
  constructor(id = 'plugin-events', config = {}) {
    super(id, config, {
      tagName: 'plugin-events',
      loadComponent: () => import('./PluginEventsComponent.js'),
    });
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Plan Events',
      description: 'Display locally-stored plan events on the timeline',
      icon: 'event',
      section: 'tools',
      autoActivate: false,
    };
  }
}

export default PluginEventsPlugin;
