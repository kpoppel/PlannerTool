/**
 * PluginLinkEditor.js
 * Plugin for editing feature dependency links
 * Enables interactive editing of Predecessor, Successor, Related, and Parent links
 */

import { Plugin } from '../core/Plugin.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';
import { getLinkEditorState } from './linkeditor/LinkEditorState.js';
import './PluginLinkEditorComponent.js';
import { findInBoard } from '../components/board-utils.js';

export class PluginLinkEditor extends Plugin {
  constructor(id = 'link-editor', config = {}) {
    super(id, config);
    this._component = null;
    this._linkEditorState = getLinkEditorState();
    this._boundOnFeatureUpdate = this._onFeatureUpdate.bind(this);
  }

  /**
   * Get plugin metadata
   * @returns {Object}
   */
  getMetadata() {
    return {
      id: this.id,
      name: 'Link Editor',
      description: 'Edit dependency links between features',
      version: '1.0.0',
      author: 'PlannerTool',
      dependencies: [],
      capabilities: ['edit-links', 'scenario-integration'],
    };
  }

  /**
   * Initialize plugin
   * @returns {Promise<void>}
   */
  async init() {
    console.log('[PluginLinkEditor] init');

    // Create component if it doesn't exist
    if (!this._component) {
      this._component = document.createElement('plugin-link-editor');
    }

    this.initialized = true;
  }

  /**
   * Activate plugin
   * @returns {Promise<void>}
   */
  async activate() {
    console.log('[PluginLinkEditor] activate');

    if (!this._component) {
      await this.init();
    }

    // Attach component to the board
    try {
      const board = findInBoard('feature-board');
      if (board) {
        const hostRoot = board.shadowRoot || board;

        // Check if component is already attached
        const existing =
          hostRoot.querySelector('plugin-link-editor') ||
          document.querySelector('plugin-link-editor');

        if (existing) {
          this._component = existing;
        } else {
          try {
            hostRoot.appendChild(this._component);
          } catch (e) {
            // Fallback to document body
            document.body.appendChild(this._component);
          }
        }
      }
    } catch (err) {
      console.error('[PluginLinkEditor] Failed to attach component:', err);
    }

    // Subscribe to feature update events to refresh the UI
    bus.on(FeatureEvents.UPDATED, this._boundOnFeatureUpdate);

    // Open the component
    if (this._component && typeof this._component.open === 'function') {
      this._component.open();
    }

    this.active = true;
  }

  /**
   * Deactivate plugin
   * @returns {Promise<void>}
   */
  async deactivate() {
    console.log('[PluginLinkEditor] deactivate');

    // Unsubscribe from events
    bus.off(FeatureEvents.UPDATED, this._boundOnFeatureUpdate);

    // Close the component
    if (this._component && typeof this._component.close === 'function') {
      this._component.close();
    }

    // Clear link editor state
    this._linkEditorState.disable();
    this._linkEditorState.clear();

    this.active = false;
  }

  /**
   * Destroy plugin
   * @returns {Promise<void>}
   */
  async destroy() {
    console.log('[PluginLinkEditor] destroy');

    // Ensure deactivated
    if (this.active) {
      await this.deactivate();
    }

    // Remove component from DOM
    if (this._component && this._component.parentNode) {
      this._component.parentNode.removeChild(this._component);
    }
    this._component = null;

    this.initialized = false;
  }

  /**
   * Handle feature update events
   * @private
   */
  _onFeatureUpdate(payload) {
    console.log('[PluginLinkEditor] Feature updated:', payload);

    // Trigger a re-render of dependency lines if the DependencyRenderer exists
    try {
      import('../components/DependencyRenderer.lit.js').then((module) => {
        if (module.refreshDependencies) {
          module.refreshDependencies();
        }
      });
    } catch (err) {
      // DependencyRenderer may not be loaded, ignore
    }

    // Request update on component if it exists
    if (this._component && typeof this._component.requestUpdate === 'function') {
      this._component.requestUpdate();
    }
  }

  /**
   * Get the component instance
   * @returns {PluginLinkEditorComponent|null}
   */
  getComponent() {
    return this._component;
  }
}

export default PluginLinkEditor;
