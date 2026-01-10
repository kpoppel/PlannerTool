/**
 * PluginAnnotations
 * Lifecycle wrapper for the Annotations plugin
 * Provides SVG annotation tools for the timeline view
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginAnnotations {
  constructor(id = 'plugin-annotations', config = {}) {
    this.id = id;
    this.config = config;
    this._el = null;
    this._host = null;
    this._componentLoaded = false;
    this.initialized = false;
    this.active = false;
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Annotations',
      description: this.config.description || 'Add notes, shapes and lines to the timeline',
      icon: this.config.icon || 'edit_note',
      section: 'tools',
      autoActivate: false
    };
  }

  async init() {
    if (!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if (!this._componentLoaded) {
      await import('./PluginAnnotationsComponent.js');
      this._componentLoaded = true;
    }
    const selector = this.config.mountPoint || 'feature-board';
    this._host = document.querySelector(selector) || document.body;
    this.initialized = true;
  }

  async activate() {
    if (!this._componentLoaded) await this.init();
    if (!this._host) {
      const selector = this.config.mountPoint || 'feature-board';
      this._host = document.querySelector(selector) || document.body;
    }
    if (!this._el) {
      this._el = document.createElement('plugin-annotations');
      // Decide where to mount the plugin element (toolbox).
      // The annotation SVG overlay itself is attached into the feature-board
      // by the component's `firstUpdated()` logic; the plugin's toolbox should
      // live in the app container so it's on top of the feature board UI.
      const selector = this.config.mountPoint || 'feature-board';
      const board = document.querySelector('feature-board');
      const appRoot = document.querySelector('.app-container') || document.getElementById('app') || document.body;

      // If the config explicitly requests mounting somewhere other than the
      // app container, honor it. Otherwise, put the toolbox into the app root.
      const mountToBoard = (selector && selector === 'feature-board' && this.config.forceMountInBoard);
      const mountTarget = mountToBoard ? (board || document.body) : appRoot;

      // Only apply board-specific inset positioning when the plugin element
      // itself will be a child of the board. Normally we append the element
      // to the app container and let the component place the overlay inside
      // the board, so avoid setting board-scoped styles here in that common case.
      if (mountToBoard && board) {
        try {
          this._el.style.position = 'absolute';
          this._el.style.top = '0';
          this._el.style.left = '0';
          this._el.style.right = '0';
          this._el.style.bottom = '0';
          this._el.style.width = 'auto';
          this._el.style.height = 'auto';
          this._el.style.pointerEvents = 'auto';
          this._el.style.zIndex = '10';
        } catch (e) { /* ignore */ }
      }

      try { mountTarget.appendChild(this._el); } catch (e) { try { document.body.appendChild(this._el); } catch (err) { /* ignore */ } }

      // Keep sizing in sync with the board so it doesn't float over sidebars
      try {
        const board = document.querySelector('feature-board');
        if (board) {
          // With inset positioning we don't need to explicitly set pixel
          // width/height on every resize — but we still need to trigger a
          // repaint/update when the board size changes (e.g., window resize
          // or internal scroll). Keep lightweight handlers that invalidate
          // layout when needed.
          const resizeFn = () => {
            try {
              // toggle a CSS property to force repaint if necessary
              this._el.style.transform = 'translateZ(0)';
              // then clear it to avoid buildup
              setTimeout(() => { try { this._el.style.transform = ''; } catch (e) { /* ignore */ } }, 0);
            } catch (e) { /* ignore */ }
          };

          const onScroll = () => { resizeFn(); };

          this._annotationBoardHandlers = { resizeFn, onScroll, board };

          window.addEventListener('resize', resizeFn);
          try { board.addEventListener('scroll', onScroll); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        // ignore
      }
    }
    if (this._el && typeof this._el.open === 'function') {
      this._el.open();
    }
    this.active = true;
    bus.emit(PluginEvents.ACTIVATED, { id: this.id });
  }

  async deactivate() {
    if (this._el && typeof this._el.close === 'function') {
      this._el.close();
    }
    this.active = false;
    bus.emit(PluginEvents.DEACTIVATED, { id: this.id });
  }

  async destroy() {
    if (this._el && this._el.parentNode) {
      this._el.parentNode.removeChild(this._el);
    }
    this._el = null;
    // Remove any attached handlers for board resizing/scroll
    try {
      if (this._annotationBoardHandlers) {
        const { resizeFn, onScroll, board } = this._annotationBoardHandlers;
        try { window.removeEventListener('resize', resizeFn); } catch (e) { /* ignore */ }
        try { if (board && board.removeEventListener) board.removeEventListener('scroll', onScroll); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    this._annotationBoardHandlers = null;
    this.initialized = false;
    this.active = false;
  }

  toggle() {
    this.active ? this.deactivate() : this.activate();
  }
  
  /**
   * Check if annotations plugin is currently active
   * @returns {boolean}
   */
  isActive() {
    return this.active;
  }
  
  /**
   * Get the annotation state for use by other plugins (e.g., Export)
   * @returns {AnnotationState|null}
   */
  getAnnotationState() {
    // Lazy import to avoid circular dependencies
    return import('./annotations/AnnotationState.js').then(mod => mod.getAnnotationState());
  }
}

export default PluginAnnotations;
