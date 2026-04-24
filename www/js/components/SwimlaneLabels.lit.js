/**
 * Module: SwimlaneLabels
 * Intent: Fixed left-column component that renders project name labels for each
 * swimlane in plan summary mode.
 *
 * Layout:
 *  - Positioned as a sibling to #scroll-container inside TimelineBoard
 *  - Fixed horizontally (does not scroll left/right)
 *  - Syncs vertical scroll with the board scroll container so labels stay
 *    aligned with their swimlane rows
 *
 * @typedef {{ project: Object, offsetY: number, totalHeight: number }} SwimlaneLabelDef
 */

import { LitElement, html, css } from '../vendor/lit.js';

export const SWIMLANE_LABEL_WIDTH = 160; // px — must match CSS --swimlane-label-width

class SwimlaneLabels extends LitElement {
  static properties = {
    /** @type {SwimlaneLabelDef[]} */
    swimlanes: { type: Array },
    /** Vertical scroll offset in px, kept in sync with the board scroll container */
    _scrollTop: { type: Number, state: true },
  };

  constructor() {
    super();
    this.swimlanes = [];
    this._scrollTop = 0;
    this._scrollHandler = null;
  }

  static styles = css`
    :host {
      display: block;
      position: absolute;
      top: 0;
      left: 0;
      width: ${SWIMLANE_LABEL_WIDTH}px;
      /* Sit above the board content but below modals */
      z-index: 50;
      pointer-events: none;
      /* White panel so the labels remain readable over any board background */
      background: rgba(255, 255, 255, 0.97);
      box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
      overflow: hidden;
    }

    .labels-inner {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      /* translated vertically by JS to sync with scroll */
    }

    .swimlane-label {
      position: absolute;
      left: 0;
      width: 100%;
      display: flex;
      align-items: flex-start;
      padding-top: 4px;
      box-sizing: border-box;
      pointer-events: auto;
    }

    .color-accent {
      flex: 0 0 4px;
      align-self: stretch;
      border-radius: 2px 0 0 2px;
      margin-right: 8px;
    }

    .label-text {
      flex: 1 1 auto;
      min-width: 0;
    }

    .project-icon {
      font-size: 13px;
      margin-right: 4px;
      opacity: 0.85;
    }

    .project-name {
      font-size: 12px;
      font-weight: 700;
      color: #1a2735;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .lane-divider {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: rgba(0, 0, 0, 0.1);
    }
  `;

  /**
   * Attach scroll listener to the board scroll container so labels track vertically.
   * @param {HTMLElement} scrollContainer
   */
  attachScrollSync(scrollContainer) {
    if (this._scrollHandler) {
      scrollContainer.removeEventListener('scroll', this._scrollHandler);
    }
    this._scrollHandler = () => {
      this._scrollTop = scrollContainer.scrollTop;
    };
    scrollContainer.addEventListener('scroll', this._scrollHandler, { passive: true });
    // Sync initial value
    this._scrollTop = scrollContainer.scrollTop;
  }

  /**
   * Detach the scroll listener.
   * @param {HTMLElement} scrollContainer
   */
  detachScrollSync(scrollContainer) {
    if (this._scrollHandler) {
      scrollContainer.removeEventListener('scroll', this._scrollHandler);
      this._scrollHandler = null;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Scroll container reference no longer available — listeners cleaned up by caller
  }

  render() {
    if (!this.swimlanes?.length) return html``;

    // The inner div translates upward by scrollTop so labels track the board content.
    // The labels container is already positioned below the sticky timeline header
    // (TimelineBoard sets top = maingraphH + timelineH), so no extra offset is needed.
    const translateY = -this._scrollTop;

    return html`
      <div
        class="labels-inner"
        style="transform: translateY(${translateY}px)"
      >
        ${this.swimlanes.map((lane) => {
          const color = lane.project?.color ?? '#4a6fa5';
          const name = lane.project?.name ?? 'Unnamed';
          const icon = lane.project?.icon ?? '';
          return html`
            <div
              class="swimlane-label"
              style="top: ${lane.offsetY}px; height: ${lane.totalHeight}px; background: ${color}18;"
            >
              <div class="color-accent" style="background: ${color}"></div>
              <div class="label-text">
                ${icon ? html`<span class="project-icon">${icon}</span>` : ''}
                <div class="project-name" title="${name}">${name}</div>
              </div>
              <div class="lane-divider"></div>
            </div>
          `;
        })}
      </div>
    `;
  }
}

customElements.define('swimlane-labels', SwimlaneLabels);
