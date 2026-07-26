/**
 * PluginAnnotations - Lifecycle wrapper for SVG annotation tools.
 * Standard MountedPlugin — floating toolbar style (matching PluginHistory).
 */
import { MountedPlugin } from './MountedPlugin.js';

export class PluginAnnotations extends MountedPlugin {
  static get defaultId() { return 'plugin-annotations'; }

  constructor(id = PluginAnnotations.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-annotations'; }
  get componentPath() { return './PluginAnnotationsComponent.js'; }
  get mountSelector() { return '_body'; }

  async activate() {
    await super.activate();
    if (this._el?.open) this._el.open();
  }

  async deactivate() {
    if (this._el?.close) this._el.close();
    await super.deactivate();
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Annotations',
      description: this.config.description || 'Add notes, shapes and lines to the timeline',
      icon: this.config.icon || 'edit_note',
      section: 'tools',
      autoActivate: false,
    };
  }

  isActive() { return this.active; }

  async getAnnotationState() {
    const mod = await import('./annotations/AnnotationState.js');
    return mod.getAnnotationState();
  }
}

export default PluginAnnotations;
