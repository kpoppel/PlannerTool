import { LitElement, html, css } from '../vendor/lit.js';

/**
 * GhostTitle component - displays the full title of a feature card
 * when it overflows. Can either attach to the card or stick to viewport edges.
 */
class GhostTitle extends LitElement {
  static properties = {
    title: { type: String },
    visible: { type: Boolean, reflect: true },
    /* stuck-to-edge behavior removed */
    borderColor: { type: String },
    cardRect: { type: Object },
    boardRect: { type: Object },
    featureId: { type: String }
  };

  constructor() {
    super();
    this.title = '';
    this.visible = false;
    this.borderColor = '#666';
    this.cardRect = null;
    this.boardRect = null;
    this.featureId = null;
    this._rafId = null;
    this._resizeObserver = null;
    this._cachedGhostSize = null; // { width, height }
  }

  static styles = css`
    :host {
      position: absolute;
      background: transparent;
      border: 1px dashed rgba(0,0,0,0.25);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      color: rgba(0,0,0,0.75);
      z-index: 120;
      pointer-events: none;
      line-height: 1.1;
      text-align: left;
      white-space: nowrap;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s ease-in-out;
      max-width: none;
    }

    :host([visible]) {
      opacity: 1;
      visibility: visible;
    }


    .arrow {
      position: absolute;
      right: -10px;
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border-top: 10px solid transparent;
      border-bottom: 10px solid transparent;
      border-left: 10px solid rgba(0, 0, 0, 0.1);
    }
  `;

  updated(changedProperties) {
    if (changedProperties.has('borderColor')) {
      this.style.setProperty('--border-color', this.borderColor);
    }

    if (changedProperties.has('cardRect') ||
        changedProperties.has('boardRect') ||
        changedProperties.has('visible') ||
        changedProperties.has('featureId') ||
        changedProperties.has('title')) {
      this._schedulePositionUpdate();
    }
  }

  _schedulePositionUpdate() {
    if (!this.visible) return;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._performPositioning();
    });
  }

  _performPositioning() {
    if (!this.visible) return;

    // Prefer authoritative geometry from the board's LayoutManager when available.
      // Prefer authoritative geometry from LayoutManager; require both
      // `cardRect` (per-feature) and `boardRect` (board content) to continue.
      let cardRect = this.cardRect;
      let boardRect = this.boardRect;
      if (this.getRootNode) {
        try {
          const root = this.getRootNode();
          const featureBoard = root && root.host ? root.host : null;
          if (featureBoard && featureBoard._layout) {
            if (this.featureId) {
              const geom = featureBoard._layout.getGeometry(this.featureId);
              if (geom) cardRect = { left: geom.left, top: geom.top, width: geom.width, height: geom.height };
            }
            if (typeof featureBoard._layout.getBoardRect === 'function') {
              const br = featureBoard._layout.getBoardRect();
              if (br) boardRect = br;
            }
          }
        } catch (e) { /* ignore layout lookup errors */ }
      }

      if (!cardRect || !boardRect) return;

      // Use cached ghost size from ResizeObserver to avoid forcing layout.
      if (!this._cachedGhostSize) {
        if (typeof ResizeObserver !== 'undefined') {
          try {
            if (!this._resizeObserver) {
              this._resizeObserver = new ResizeObserver((entries) => {
                for (const ent of entries) {
                  if (ent && ent.contentRect) {
                    this._cachedGhostSize = { width: ent.contentRect.width, height: ent.contentRect.height };
                    // Defer positioning until next RAF to allow other updates
                    this._schedulePositionUpdate();
                  }
                }
              });
            }
            this._resizeObserver.observe(this);
          } catch (e) { /* ignore observer failures */ }
        }
        return;
      }

      const gap = 12;
      const cr = cardRect;
      const br = boardRect;
      const cardLeft = cr.left;
      const cardTop = cr.top;
      const cardWidth = cr.width;
      const cardHeight = cr.height;

      const scrollLeft = (br && br.left) || 0;
      const viewportWidth = br.width || 0;

      const ghostWidth = Math.round(this._cachedGhostSize.width || 0);
      const ghostHeight = Math.round(this._cachedGhostSize.height || 0);

      const cardLeftInViewport = cardLeft - scrollLeft;
      const cardRightInViewport = cardLeftInViewport + cardWidth;

      const cardLeftVisible = cardLeftInViewport >= 0 && cardLeftInViewport <= viewportWidth;
      const cardRightVisible = cardRightInViewport >= 0 && cardRightInViewport <= viewportWidth;
      const isCardOnScreen = cardLeftVisible || cardRightVisible;

      let ghostLeft, ghostTop;
      let isStuck = false;

      if (isCardOnScreen) {
        ghostLeft = cardLeft - ghostWidth - gap;
        ghostTop = cardTop + (cardHeight / 2) - (ghostHeight / 2);
        const minLeft = scrollLeft + gap;
        if (ghostLeft < minLeft) {
          ghostLeft = minLeft;
          isStuck = true;
        }
      } else {
        isStuck = true;
        if (cardRightInViewport < 0) {
          ghostLeft = scrollLeft + gap;
        } else if (cardLeftInViewport > viewportWidth) {
          ghostLeft = scrollLeft + viewportWidth - ghostWidth - gap;
        } else {
          ghostLeft = cardLeft - ghostWidth - gap;
          if (ghostLeft < scrollLeft + gap) ghostLeft = scrollLeft + gap; else isStuck = false;
        }
        ghostTop = cardTop + (cardHeight / 2) - (ghostHeight / 2);
      }


      // Compute `right` relative to board content width (authoritative from LayoutManager)
      const boardContentWidth = br.width || 0;
      let ghostRight;
      if (!isStuck) {
        const desiredRightInBoard = cardLeft - gap; // board-content coord for ghost's right
        ghostRight = Math.round(boardContentWidth - desiredRightInBoard);
      } else {
        ghostRight = Math.round(boardContentWidth - (ghostLeft + ghostWidth));
      }
    try { this.style.left = ''; } catch (e) { }
    this.style.right = `${ghostRight}px`;
    this.style.top = `${Math.round(ghostTop)}px`;
  }

  _splitTitleAtMiddle(title) {
    if (!title) return '';
    const words = title.split(/\s+/);
    if (words.length < 4) {
      return title; // Don't split short titles
    }
    const mid = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, mid).join(' ');
    const secondHalf = words.slice(mid).join(' ');
    return html`${firstHalf}<br/>${secondHalf}`;
  }

  render() {
    return html`
      ${this._splitTitleAtMiddle(this.title)}
      <div class="arrow"></div>
    `;
  }
}

customElements.define('ghost-title-lit', GhostTitle);

export { GhostTitle };
