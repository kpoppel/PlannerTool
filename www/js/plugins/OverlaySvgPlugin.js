/**
 * OverlaySvgPlugin.js
 * Base class for plugins that render an SVG overlay on the board card area.
 *
 * Provides common lifecycle management shared by all board overlay plugins:
 *  - Overlay div + SVG creation inside #board-area (firstUpdated)
 *  - Scroll subscription via boardCoords instead of raw DOM scroll listeners
 *  - rAF-debounced render scheduling (_scheduleRender)
 *  - open() / close() visibility management
 *
 * Subclasses MUST implement:
 *  - _renderSvg()            – draw into this._svgEl; called on every scheduled update
 *  - _subscribeBusEvents()   – call bus.on(...) for events that trigger re-renders
 *  - _unsubscribeBusEvents() – matching bus.off(...) calls
 *
 * Subclasses MAY override:
 *  - static overlayClass     – CSS class for the wrapper div (default: 'overlay-svg-plugin')
 *  - static zIndex           – CSS z-index for the overlay wrapper (default: '125')
 *  - open() / close()        – extend with data loading or extra DOM work
 *
 * The overlay div is appended into #board-area as a position:absolute sibling of
 * feature-board, so its coordinate system matches board space directly:
 *  (0,0) = top-left of the card area, matching BoardCoordinateService's board space.
 */

import { LitElement } from '../vendor/lit.js';
import { boardCoords } from '../services/BoardCoordinateService.js';
import { findInBoard } from '../components/board-utils.js';

export class OverlaySvgPlugin extends LitElement {
  static properties = {
    visible: { type: Boolean, reflect: true },
  };

  /** CSS class applied to the overlay wrapper div. Override in subclasses. */
  static overlayClass = 'overlay-svg-plugin';

  /** z-index for the overlay wrapper div. Override in subclasses if needed. */
  static zIndex = '125';

  constructor() {
    super();
    this.visible = false;
    /** @type {SVGSVGElement|null} The SVG element to draw into. */
    this._svgEl = null;
    /** @type {HTMLElement|null} The wrapper div appended to #board-area. */
    this._overlay = null;
    this._renderScheduled = false;
    /** @type {Function|null} Unsubscribe returned by boardCoords.subscribe(). */
    this._coordsUnsubscribe = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    // Use boardCoords for scroll events — replaces per-plugin raw scroll listeners
    this._coordsUnsubscribe = boardCoords.subscribe(() => this._scheduleRender());
    this._subscribeBusEvents();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._coordsUnsubscribe) {
      this._coordsUnsubscribe();
      this._coordsUnsubscribe = null;
    }
    this._unsubscribeBusEvents();
    this._overlay?.remove();
    this._overlay = null;
    this._svgEl = null;
  }

  /**
   * Creates the overlay wrapper div and SVG inside #board-area.
   * Subclasses that override firstUpdated must call super.firstUpdated() first.
   */
  firstUpdated() {
    this._attachOverlay();
  }

  // ---------------------------------------------------------------------------
  // Overlay DOM setup
  // ---------------------------------------------------------------------------

  /**
   * Creates (or re-connects) the overlay div and SVG inside #board-area.
   * Idempotent — safe to call again if the element was re-connected.
   */
  _attachOverlay() {
    const boardArea = findInBoard('#board-area');
    if (!boardArea) return;

    const cssClass = this.constructor.overlayClass;
    const zIndex = this.constructor.zIndex;

    // Re-use an existing overlay div when the component was reconnected
    let overlay = boardArea.querySelector(`.${cssClass}`);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = cssClass;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', `${cssClass}__svg`);
      // overflow:visible so paths that extend beyond the SVG bounds are still drawn.
      // pointer-events:none so mouse events fall through to cards below.
      Object.assign(svg.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      });
      overlay.appendChild(svg);
      boardArea.appendChild(overlay);
    }

    // Apply or re-apply positioning and visibility CSS
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex,
      overflow: 'hidden',
      display: this.visible ? '' : 'none',
    });

    this._overlay = overlay;
    this._svgEl = overlay.querySelector(`.${cssClass}__svg`);
  }

  // ---------------------------------------------------------------------------
  // Render scheduling
  // ---------------------------------------------------------------------------

  /**
   * Schedule a call to _renderSvg() on the next animation frame.
   * No-ops when the plugin is not visible or a render is already queued.
   */
  _scheduleRender() {
    if (!this.visible || this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this._renderSvg();
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Make the overlay visible and trigger an immediate render.
   * Override to add data loading; call super.open() to apply visibility.
   */
  open() {
    this.visible = true;
    this.setAttribute('visible', '');
    if (this._overlay) this._overlay.style.display = '';
    this._renderSvg();
  }

  /**
   * Hide the overlay and clear its contents.
   * Override to clean up plugin-specific state; call super.close().
   */
  close() {
    this.visible = false;
    this.removeAttribute('visible');
    if (this._overlay) this._overlay.style.display = 'none';
    if (this._svgEl) this._svgEl.innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // Abstract hooks — implement in subclasses
  // ---------------------------------------------------------------------------

  /** Draw into this._svgEl. Called on every scheduled render. */
  _renderSvg() {}

  /**
   * Subscribe to bus events that should trigger re-renders.
   * Called from connectedCallback after the scroll subscription is established.
   */
  _subscribeBusEvents() {}

  /**
   * Unsubscribe all bus events registered in _subscribeBusEvents().
   * Called from disconnectedCallback before the overlay is removed.
   */
  _unsubscribeBusEvents() {}
}
