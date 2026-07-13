/**
 * PluginMarkers - Lifecycle wrapper for delivery plan markers overlay
 */
import { OverlayPlugin } from './OverlayPlugin.js';

class PluginMarkers extends OverlayPlugin {
  constructor(id = 'plugin-markers', config = {}) {
    super(id, config, {
      tagName: 'plugin-markers',
      loadComponent: () => import('./PluginMarkersComponent.js'),
    });
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Plan Markers',
      description: 'Display delivery plan markers on timeline',
      icon: 'flag',
      section: 'tools',
      autoActivate: false,
    };
  }
}

export default PluginMarkers;
