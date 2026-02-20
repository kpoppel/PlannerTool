import { LitElement, html, css } from '../vendor/lit.js';

/**
 * GhostTitle component - displays the full title of a feature card
 * when it overflows. Can either attach to the card or stick to viewport edges.
 */
class GhostTitle extends LitElement {
  static properties = {
    title: { type: String },
    visible: { type: Boolean, reflect: true },
    stuckToEdge: { type: Boolean, reflect: true },
    borderColor: { type: String },
    cardRect: { type: Object },
    boardRect: { type: Object }
  };

  constructor() {
    super();
    this.title = '';
    this.visible = false;
    this.stuckToEdge = false;
    this.borderColor = '#666';
    this.cardRect = null;
    this.boardRect = null;
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

    :host([stuck-to-edge]) {
      border-left: 6px solid var(--border-color, #666);
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
        changedProperties.has('visible')) {
      this._updatePosition();
    }
  }

  _updatePosition() {
    if (!this.visible || !this.cardRect || !this.boardRect) {
      return;
    }

    // Use RAF to ensure we have dimensions after render
    requestAnimationFrame(() => {
      const ghostWidth = this.offsetWidth;
      const ghostHeight = this.offsetHeight;

      if (ghostWidth === 0 || ghostHeight === 0) {
        // Not laid out yet, try again
        requestAnimationFrame(() => this._updatePosition());
        return;
      }

      const gap = 12;
      const cardRect = this.cardRect;
      const boardRect = this.boardRect;

      // cardRect now contains offsetLeft/offsetTop (absolute position within board)
      // boardRect.width is the visible viewport width
      const cardLeft = cardRect.left;
      const cardTop = cardRect.top;
      const cardWidth = cardRect.width;
      const cardHeight = cardRect.height;

      // Get the feature-board's scroll position to determine what's visible
      const featureBoard = document.querySelector('feature-board');
      if (!featureBoard) return;
      
      const scrollLeft = featureBoard.scrollLeft || 0;
      const viewportWidth = boardRect.width;

      // Calculate card position relative to visible viewport
      const cardLeftInViewport = cardLeft - scrollLeft;
      const cardRightInViewport = cardLeftInViewport + cardWidth;

      // Check if card is visible in the scrolling viewport
      const cardLeftVisible = cardLeftInViewport >= 0 && cardLeftInViewport <= viewportWidth;
      const cardRightVisible = cardRightInViewport >= 0 && cardRightInViewport <= viewportWidth;
      const isCardOnScreen = cardLeftVisible || cardRightVisible;

      let ghostLeft, ghostTop;
      let isStuck = false;

      if (isCardOnScreen) {
        // Card is on-screen: position ghost to the left of the card
        ghostLeft = cardLeft - ghostWidth - gap;
        ghostTop = cardTop + (cardHeight / 2) - (ghostHeight / 2);
        
        // Clamp ghostLeft to not go off the left edge of visible area
        if (ghostLeft < scrollLeft) {
          ghostLeft = scrollLeft + gap;
          isStuck = true;
        }
      } else {
        // Card is off-screen: stick ghost to the visible edge
        isStuck = true;
        if (cardRightInViewport < 0) {
          // Card is off-screen to the left: stick ghost to left edge
          ghostLeft = scrollLeft + gap;
        } else if (cardLeftInViewport > viewportWidth) {
          // Card is off-screen to the right: stick ghost to right edge
          ghostLeft = scrollLeft + viewportWidth - ghostWidth - gap;
        } else {
          // Fallback to normal positioning
          ghostLeft = cardLeft - ghostWidth - gap;
          if (ghostLeft < scrollLeft) {
            ghostLeft = scrollLeft + gap;
          } else {
            isStuck = false;
          }
        }
        ghostTop = cardTop + (cardHeight / 2) - (ghostHeight / 2);
      }

      // Update stuck state
      this.stuckToEdge = isStuck;

      // Don't clamp vertical position - let browser handle clipping with overflow
      this.style.left = `${ghostLeft}px`;
      this.style.top = `${ghostTop}px`;
    });
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
