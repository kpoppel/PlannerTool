// LinkEditorOverlay.js
// Manages the interactive overlay for link editing

import { LitElement, html, css } from '../../vendor/lit.js';
import { getLinkEditorState } from './LinkEditorState.js';

/**
 * LinkEditorOverlay
 * LitElement component providing an interactive overlay for selecting link types and target features
 */
export class LinkEditorOverlay extends LitElement {
  static properties = {
    active: { type: Boolean, reflect: true }
  };

  constructor() {
    super();
    this.active = false;
    this._state = getLinkEditorState();
    this._board = null;
    this._styleEl = null;
    this._overlayContainer = null;
    this._boundOnClick = this._onClick.bind(this);
    this._boundOnKeyDown = this._onKeyDown.bind(this);
  }

  static styles = css`
    :host {
      display: none;
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 10;
    }

    :host([active]) {
      display: block;
      pointer-events: auto;
    }
  `;

  /**
   * Get current pending action (if any)
   */
  get pendingAction() {
    return this._state.pendingAction;
  }

  /**
   * Enable the overlay
   */
  enable() {
    console.log('[LinkEditorOverlay] Enabling overlay');
    this.active = true;
    this._injectStyles();
    this._attachEventHandlers();
    document.addEventListener('keydown', this._boundOnKeyDown);
  }

  /**
   * Disable the overlay
   */
  disable() {
    console.log('[LinkEditorOverlay] Disabling overlay');
    this.active = false;
    this._detachEventHandlers();
    this._removeStyles();
    document.removeEventListener('keydown', this._boundOnKeyDown);
  }

  render() {
    return html``;
  }

  /**
   * Inject CSS styles into the document head for quadrants in light DOM
   * @private
   */
  _injectStyles() {
    if (this._styleEl) return; // Already injected

    const css = `
      /* Link Editor: Quadrant overlays on feature cards */
      #link-editor-overlay-container {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 100;
      }
      
      .link-editor-quadrants {
        position: absolute;
        pointer-events: auto;
        z-index: 10;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      
      .link-editor-quadrants:hover,
      .link-editor-quadrants.source {
        opacity: 1;
      }
      
      [data-link-area] {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        pointer-events: auto;
        cursor: pointer;
        user-select: none;
        transition: transform 0.08s ease;
      }
      
      [data-link-area]:hover {
        transform: scale(1.05);
        filter: brightness(1.1);
      }
      
      [data-link-area].active {
        outline: 3px solid rgba(255,255,255,0.5);
        box-shadow: 0 0 12px rgba(0,0,0,0.4);
      }
      
      [data-link-area="Predecessor"] {
        left: 0;
        top: 10%;
        bottom: 10%;
        width: 20%;
        background: linear-gradient(135deg, rgba(42,208,214,0.95), rgba(31,184,190,0.95));
        border-top-left-radius: 6px;
        border-bottom-left-radius: 6px;
      }
      
      [data-link-area="Successor"] {
        right: 0;
        top: 10%;
        bottom: 10%;
        width: 20%;
        background: linear-gradient(135deg, rgba(12,165,138,0.95), rgba(10,137,114,0.95));
        border-top-right-radius: 6px;
        border-bottom-right-radius: 6px;
      }
      
      [data-link-area="Parent"] {
        left: 30%;
        right: 30%;
        top: 0;
        height: 22%;
        background: linear-gradient(180deg, rgba(255,211,79,0.95), rgba(245,196,58,0.95));
        color: #333;
        text-shadow: 0 1px 1px rgba(255,255,255,0.4);
        border-top-left-radius: 6px;
        border-top-right-radius: 6px;
      }
      
      [data-link-area="Related"] {
        left: 28%;
        right: 28%;
        bottom: 0;
        height: 22%;
        background: linear-gradient(180deg, rgba(47,191,79,0.95), rgba(38,160,65,0.95));
        border-bottom-left-radius: 6px;
        border-bottom-right-radius: 6px;
      }
    `;

    this._styleEl = document.createElement('style');
    this._styleEl.textContent = css;
    document.head.appendChild(this._styleEl);
    
    console.log('[LinkEditorOverlay] Styles injected');
  }

  /**
   * Remove injected styles
   * @private
   */
  _removeStyles() {
    if (this._styleEl && this._styleEl.parentNode) {
      this._styleEl.parentNode.removeChild(this._styleEl);
      this._styleEl = null;
    }
    
    // Remove overlay container
    if (this._overlayContainer && this._overlayContainer.parentNode) {
      this._overlayContainer.parentNode.removeChild(this._overlayContainer);
      this._overlayContainer = null;
    }
  }

  render() {
    return html``;
  }

  /**
   * Attach event handlers to the board and create positioned overlays
   * @private
   */
  _attachEventHandlers() {
    const board = document.querySelector('feature-board');
    if (!board) {
      console.warn('[LinkEditorOverlay] Board not found');
      return;
    }
    
    const hostRoot = board.shadowRoot || board;
    const cards = hostRoot.querySelectorAll('feature-card-lit[data-feature-id]');
    
    console.log('[LinkEditorOverlay] Found', cards.length, 'cards');
    
    // Create a container for all overlays (append to document.body to avoid shadow DOM encapsulation)
    const overlayContainer = document.createElement('div');
    overlayContainer.id = 'link-editor-overlay-container';
    overlayContainer.style.position = 'absolute';
    overlayContainer.style.pointerEvents = 'none';
    overlayContainer.style.zIndex = '100';
    
    // Get board position for absolute positioning relative to the page
    const boardRect = board.getBoundingClientRect();
    const pageX = window.scrollX || window.pageXOffset || 0;
    const pageY = window.scrollY || window.pageYOffset || 0;
    
    cards.forEach(card => {
      const featureId = card.getAttribute('data-feature-id');
      if (!featureId) return;
      
      // Get card position relative to viewport
      const cardRect = card.getBoundingClientRect();
      
      // Calculate position relative to board
      const left = cardRect.left - boardRect.left;
      const top = cardRect.top - boardRect.top;
      const width = cardRect.width;
      const height = cardRect.height;
      
      // Create quadrants container for this card
      const quadrants = document.createElement('div');
      quadrants.className = 'link-editor-quadrants';
      quadrants.dataset.featureId = featureId;
      quadrants.style.position = 'absolute';
      quadrants.style.left = `${left}px`;
      quadrants.style.top = `${top}px`;
      quadrants.style.width = `${width}px`;
      quadrants.style.height = `${height}px`;
      quadrants.style.pointerEvents = 'auto';
      quadrants.style.zIndex = '10';
      
      // Create quadrant areas
      ['Predecessor', 'Successor', 'Parent', 'Related'].forEach(action => {
        const area = document.createElement('div');
        area.setAttribute('data-link-area', action);
        area.textContent = action;
        area.dataset.featureId = featureId;
        quadrants.appendChild(area);
      });
      
      overlayContainer.appendChild(quadrants);
    });
    
    // Append container to document body (light DOM) and position it over the board
    document.body.appendChild(overlayContainer);
    overlayContainer.style.left = `${Math.round(boardRect.left + pageX)}px`;
    overlayContainer.style.top = `${Math.round(boardRect.top + pageY)}px`;
    overlayContainer.style.width = `${Math.round(boardRect.width)}px`;
    overlayContainer.style.height = `${Math.round(boardRect.height)}px`;
    this._overlayContainer = overlayContainer;
    
    // Add click handler to board
    board.addEventListener('click', this._boundOnClick, true);
    this._board = board;
    
    console.log('[LinkEditorOverlay] Event handlers attached to', cards.length, 'cards');
  }

  /**
   * Detach event handlers
   * @private
   */
  _detachEventHandlers() {
    if (this._board) {
      this._board.removeEventListener('click', this._boundOnClick, true);
    }
    
    // Remove overlay container
    if (this._overlayContainer && this._overlayContainer.parentNode) {
      this._overlayContainer.parentNode.removeChild(this._overlayContainer);
      this._overlayContainer = null;
    }
  }

  /**
   * Handle clicks on cards and quadrant areas
   * @private
   */
  _onClick(e) {
    // Find if click was on a link area
    const linkArea = e.target.closest('[data-link-area]');
    if (linkArea) {
      e.stopPropagation();
      e.preventDefault();
      
      const action = linkArea.getAttribute('data-link-area');
      const featureId = linkArea.dataset.featureId;
      
      if (featureId) {
        this._onAreaClick(action, featureId, linkArea);
      }
      return;
    }
    
    // Check if click was on a card (for completing pending action)
    if (this.pendingAction) {
      const card = e.target.closest('feature-card-lit[data-feature-id]');
      if (card) {
        const targetId = card.getAttribute('data-feature-id');
        if (targetId) {
          e.stopPropagation();
          e.preventDefault();
          this._onCardClick(targetId);
        }
      }
    }
  }

  /**
   * Handle area click (start link action)
   * @private
   */
  _onAreaClick(action, featureId, areaEl) {
    console.log('[LinkEditorOverlay] Area clicked:', action, featureId);
    
    // Clear any previous active areas
    document.querySelectorAll('[data-link-area].active').forEach(el => {
      el.classList.remove('active');
    });
    
    // Clear source class from all quadrants
    document.querySelectorAll('.link-editor-quadrants.source').forEach(el => {
      el.classList.remove('source');
    });
    
    // Mark this area as active
    areaEl.classList.add('active');
    
    // Mark parent quadrants container as source
    const quadrantsContainer = areaEl.closest('.link-editor-quadrants');
    if (quadrantsContainer) {
      quadrantsContainer.classList.add('source');
    }
    
    // Start action in state
    this._state.startAction(action, featureId);
  }

  /**
   * Handle card click (complete link action)
   * @private
   */
  _onCardClick(targetId) {
    if (!this.pendingAction) return;

    console.log('[LinkEditorOverlay] Card clicked as target:', targetId);

    const success = this._state.completeAction(targetId);

    if (success) {
      // Clear active states
      document.querySelectorAll('[data-link-area].active').forEach(el => {
        el.classList.remove('active');
      });
      document.querySelectorAll('.link-editor-quadrants.source').forEach(el => {
        el.classList.remove('source');
      });
    }
  }

  /**
   * Handle keyboard events
   * @private
   */
  _onKeyDown(e) {
    if (e.key === 'Escape' && this.pendingAction) {
      e.preventDefault();
      this._state.cancelAction();
      
      // Clear active states
      document.querySelectorAll('[data-link-area].active').forEach(el => {
        el.classList.remove('active');
      });
      document.querySelectorAll('.link-editor-quadrants.source').forEach(el => {
        el.classList.remove('source');
      });
    }
  }

  /**
   * Clear all active states
   */
  clearAll() {
    document.querySelectorAll('[data-link-area].active').forEach(el => {
      el.classList.remove('active');
    });
    document.querySelectorAll('.link-editor-quadrants.source').forEach(el => {
      el.classList.remove('source');
    });
  }
}

customElements.define('link-editor-overlay', LinkEditorOverlay);

export default LinkEditorOverlay;
