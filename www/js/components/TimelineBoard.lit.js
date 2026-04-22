/**
 * TimelineBoard.lit.js
 * Host component that wires together the timeline header, feature board, and all overlays.
 *
 * Layout (shadow DOM):
 *
 *  timeline-board
 *  ├── #maingraph-section         (static, no scroll)
 *  └── #scroll-container          (single overflow:auto — handles H + V panning)
 *      ├── timeline-lit            (position:sticky; top:0 — always on screen, scrolls H)
 *      └── #board-area             (position:relative — coordinate origin for all overlays)
 *          └── feature-board       (sized to full content)
 *
 * Plugin overlays (annotation-overlay, link-editor-overlay, etc.) are appended
 * into #board-area as position:absolute siblings by their respective plugins.
 *
 * Panning: single mousedown→mousemove→mouseup handler on #scroll-container.
 * BoardCoordinateService is initialised here and provides the canonical
 * coordinate transforms used by all overlays.
 */

import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { boardCoords } from '../services/BoardCoordinateService.js';
import { bus } from '../core/EventBus.js';
import { BoardEvents, UIEvents, TimelineEvents } from '../core/EventRegistry.js';
import { calcTodayX } from './board-utils.js';

class TimelineBoard extends LitElement {
  // LitElement already uses an open shadow root by default — no need to
  // override createRenderRoot(). The static styles getter below is injected
  // automatically via Lit's adoptedStyleSheets mechanism.

  constructor() {
    super();
    this._isPanning = false;
    this._panStart = null;
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onProximityMove = this._onProximityMove.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();

    requestAnimationFrame(async () => {
      const scrollContainer = this.shadowRoot.querySelector('#scroll-container');
      const boardArea = this.shadowRoot.querySelector('#board-area');

      if (scrollContainer && boardArea) {
        boardCoords.init(scrollContainer, boardArea);
        bus.emit(BoardEvents.READY, { scrollContainer, boardArea });
      }

      if (state && state._initCompleted) await state._initCompleted;

      await import('./MainGraph.lit.js');
      const mod_t = await import('./Timeline.lit.js');

      // Ensure we register for MONTHS before initializing the timeline so
      // the initial MONTHS emission during initTimeline() isn't missed.
      this._onMonthsUpdated = (months) => this._positionTodayLine(months);
      bus.on(TimelineEvents.MONTHS, this._onMonthsUpdated);

      await mod_t.initTimeline();
      mod_t.ensureScrollToMonth();

      const mod_f = await import('./FeatureBoard.lit.js');
      await mod_f.initBoard();

      // Position today-line once months are available, and re-position on scale changes
      this._onMonthsUpdated = (months) => this._positionTodayLine(months);
      bus.on(TimelineEvents.MONTHS, this._onMonthsUpdated);

      this._enablePanning();
      this._initScrollButtons();
      document.addEventListener('mousemove', this._onProximityMove);
    });
  }

  disconnectedCallback() {
    const scroll = this.shadowRoot?.querySelector('#scroll-container');
    if (scroll) scroll.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('mousemove', this._onProximityMove);
    if (this._onDetailsShow) bus.off?.(UIEvents.DETAILS_SHOW, this._onDetailsShow);
    if (this._onDetailsHide) bus.off?.(UIEvents.DETAILS_HIDE, this._onDetailsHide);
    if (this._onMonthsUpdated) bus.off?.(TimelineEvents.MONTHS, this._onMonthsUpdated);
    super.disconnectedCallback();
  }

  _positionTodayLine(months) {
    const line = this.shadowRoot?.querySelector('#today-line');
    if (!line) return;
    const x = calcTodayX(months);
    if (x === null) {
      line.style.display = 'none';
    } else {
      line.style.left = `${x}px`;
      line.style.display = 'block';
    }
  }

  // ---------------------------------------------------------------------------
  // Panning
  // ---------------------------------------------------------------------------

  _enablePanning() {
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    if (!scroll) return;
    scroll.addEventListener('mousedown', this._onMouseDown);
  }

  _onMouseDown(e) {
    if (!boardCoords.panningAllowed) return;
    if (e.target.closest('feature-card-lit') || e.target.classList.contains('drag-handle'))
      return;
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    if (!scroll) return;
    this._isPanning = true;
    this._panStart = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
    };
    scroll.classList.add('panning');
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  _onMouseMove(e) {
    if (!this._isPanning || !this._panStart) return;
    const scroll = this.shadowRoot?.querySelector('#scroll-container');
    if (!scroll) return;
    const dx = e.clientX - this._panStart.x;
    const dy = e.clientY - this._panStart.y;
    scroll.scrollLeft = this._panStart.scrollLeft - dx;
    scroll.scrollTop = this._panStart.scrollTop - dy;
  }

  _onMouseUp() {
    this._isPanning = false;
    this._panStart = null;
    const scroll = this.shadowRoot?.querySelector('#scroll-container');
    scroll?.classList.remove('panning');
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
  }

  // ---------------------------------------------------------------------------
  // Scroll buttons
  // ---------------------------------------------------------------------------

  _initScrollButtons() {
    const scroll = this.shadowRoot.querySelector('#scroll-container');
    const btnTop = this.shadowRoot.querySelector('#btn-scroll-top');
    const btnBottom = this.shadowRoot.querySelector('#btn-scroll-bottom');

    if (btnTop)
      btnTop.addEventListener('click', () =>
        scroll?.scrollTo({ top: 0, behavior: 'smooth' })
      );
    if (btnBottom)
      btnBottom.addEventListener('click', () =>
        scroll?.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' })
      );

    const scrollButtons = this.shadowRoot.querySelector('#scroll-buttons');
    this._onDetailsShow = () => { if (scrollButtons) scrollButtons.style.display = 'none'; };
    this._onDetailsHide = () => { if (scrollButtons) scrollButtons.style.display = ''; };
    bus.on(UIEvents.DETAILS_SHOW, this._onDetailsShow);
    bus.on(UIEvents.DETAILS_HIDE, this._onDetailsHide);
  }

  _onProximityMove(e) {
    const scrollButtons = this.shadowRoot?.querySelector('#scroll-buttons');
    if (!scrollButtons) return;
    const nearEdge = window.innerWidth - e.clientX <= 60;
    scrollButtons.classList.toggle('visible', nearEdge);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  scrollTo(x, y) {
    const scroll = this.shadowRoot?.querySelector('#scroll-container');
    if (scroll) scroll.scrollTo(x, y);
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  static get styles() {
    return css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
      }

      #maingraph-section {
        flex: 0 0 auto;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
      }

      /* Single overflow container for H + V scroll / panning */
      #scroll-container {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        position: relative;
        cursor: grab;
        background: var(--app-background, #fff);
      }

      #scroll-container.panning {
        cursor: grabbing;
      }

      #scroll-container::-webkit-scrollbar {
        width: 8px;
        height: 8px;
        background: #eee;
      }
      #scroll-container::-webkit-scrollbar-thumb {
        background: #b0cbe6;
        border-radius: 4px;
      }

      /* Timeline header sticks vertically, scrolls horizontally with content.
         z-index must exceed feature-card ghost titles (z-index: 120) so cards
         scrolling past the header clip beneath it rather than overlapping. */
      timeline-lit {
        position: sticky;
        top: 0;
        z-index: 130;
        display: block;
      }

      /*
       * Board area — positioned so overlays can use position:absolute with inset:0.
       * Background stripes are on this element because its width == content width,
       * keeping stripe alignment locked to month positions regardless of scroll.
       */
      #board-area {
        position: relative;
        /* Ensure the board background (stripes) fills the visible viewport
           even when there are few or no feature cards. */
        min-height: 100vh;
        background: repeating-linear-gradient(
          to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) calc(var(--timeline-month-width, 120px) * 2)
        );
        background-position: 0 0;
      }

      #board-area.scenario-mode {
        background: repeating-linear-gradient(
          to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2)
            calc(var(--timeline-month-width, 120px) * 2)
        );
        background-position: 0 0;
      }

      /* Vertical line marking today on the feature board */
      #today-line {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: rgba(255, 59, 48, 0.7);
        pointer-events: none;
        z-index: 10;
        display: none;
      }

      #today-line::before {
        content: 'Today';
        position: absolute;
        top: 4px;
        left: 4px;
        font-size: 10px;
        font-weight: 600;
        color: rgba(255, 59, 48, 0.85);
        white-space: nowrap;
        pointer-events: none;
      }

      /* Scroll-to-top / scroll-to-bottom buttons */
      #scroll-buttons {
        position: fixed;
        right: 20px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 30;
        opacity: 0;
        transition: opacity 180ms ease;
        pointer-events: none;
      }

      #scroll-buttons.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .scroll-btn {
        width: 36px;
        height: 36px;
        border-radius: 18px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
        transition: transform 120ms ease, background 120ms ease;
      }

      .scroll-btn:hover {
        transform: translateY(-2px);
        background: #fff;
      }

      .scroll-btn:active {
        transform: translateY(0);
      }
    `;
  }

  // ---------------------------------------------------------------------------
  // Template
  // ---------------------------------------------------------------------------

  render() {
    return html`
      <section id="maingraph-section" aria-label="Organisational Load Graph">
        <maingraph-lit></maingraph-lit>
      </section>

      <div id="scroll-container">
        <timeline-lit></timeline-lit>
        <div id="board-area" role="region" aria-label="Timeline and Features">
          <feature-board></feature-board>
          <!-- Vertical marker for today's date -->
          <div id="today-line" aria-hidden="true"></div>
          <!--
            Plugin overlays (annotation-overlay, link-editor-overlay, etc.) are
            appended here by their plugins.  As position:absolute siblings inside
            a position:relative ancestor they share board-space coordinates with
            feature-board — no coordinate conversion required.
          -->
        </div>
      </div>

      <div id="scroll-buttons" aria-label="Scroll controls">
        <button id="btn-scroll-top" class="scroll-btn" title="Scroll to top">▲</button>
        <button id="btn-scroll-bottom" class="scroll-btn" title="Scroll to bottom">▼</button>
      </div>
    `;
  }
}

customElements.define('timeline-board', TimelineBoard);
