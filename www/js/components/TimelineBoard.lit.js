import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';

class TimelineBoard extends LitElement {
  static get properties() {
    return {
      offsetX: { type: Number },
      offsetY: { type: Number },
      scale: { type: Number }
    };
  }

  constructor() {
    super();
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
    this._onScroll = this._onScroll.bind(this);
  }

//  createRenderRoot() {
  

  connectedCallback() {
    super.connectedCallback();
    // Wait for layout and attach scroll handler
    requestAnimationFrame(async () => {
      const vp = this.querySelector('.timeline-board-viewport');
      if (vp) vp.addEventListener('scroll', this._onScroll, { passive: true });

      // Ensure application state initialization has completed before
      // initializing timeline and feature board. This guarantees any
      // persisted view (timeline scale) has been applied by State/ViewService
      // so downstream components render with the correct scale.
      try {
        if (state && state._initCompleted) await state._initCompleted;
      } catch (e) { /* ignore */ }

      await import('./MainGraph.lit.js');
      const mgSection = this.querySelector('#maingraphSection');
      const mod_t = await import('./Timeline.lit.js');
      await mod_t.initTimeline();
      mod_t.ensureScrollToMonth();
      const mod_f = await import('./FeatureBoard.lit.js');
      await mod_f.initBoard();
    });
  }

  disconnectedCallback() {
    const vp = this.querySelector('.timeline-board-viewport');
    if (vp) vp.removeEventListener('scroll', this._onScroll);
    super.disconnectedCallback();
  }

  _onScroll(e) {
    const vp = e.target;
    // update reactive props - use requestAnimationFrame to coalesce
    window.requestAnimationFrame(() => {
      this.offsetX = vp.scrollLeft;
      this.offsetY = vp.scrollTop;
      this.dispatchEvent(new CustomEvent('board-scroll', {
        detail: { offsetX: this.offsetX, offsetY: this.offsetY },
        bubbles: true,
        composed: true
      }));
    });
  }

  scrollTo(x, y) {
    const vp = this.querySelector('.timeline-board-viewport');
    if (vp) vp.scrollTo(x, y);
  }

  setScale(s) {
    this.scale = s;
    // scale implementation placeholder
    const inner = this.querySelector('.timeline-board-inner');
    if (inner) inner.style.transform = `scale(${s})`;
  }

  static get styles() {
    return css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
      }
      /* Scrollbar styling for timeline section only */
      .timeline-section::-webkit-scrollbar {
        height: 8px;
        width: 8px;
        background: #eee;
      }
      .timeline-section::-webkit-scrollbar-thumb {
        background: #b0cbe6;
        border-radius: 4px;
      }
      .timeline-board-viewport {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
        background: var(--app-background, #fff);
        flex: 1 1 auto;
        min-height: 0;
      }
      .timeline-board-inner {
        /* allow inner to shrink horizontally and not force a huge min-width */
        min-width: 0;
        width: 100%;
        /* allow inner to grow and let timelineSection flex to remaining height */
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        position: relative;
        min-height: 0;
      }
      .panel {
        box-sizing: border-box;
        /* border: 1px dashed rgba(0,0,0,0.08); */
        margin: 0;
        padding: 0;
        border: 0;
        background: rgba(0,0,0,0.02);
      }
      /* For the main graph we don't want the panel padding/margin to push
         the graph away from the top-left. Override the panel spacing here
         and let the graph component set its own height. */
      .maingraph-section {
        flex: 0 0 auto;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
      }
      /* Ensure timeline section stacks header + board and allows board to grow
         Remove panel spacing so the timeline/card area is flush with its container
         Also ensure the header (timeline-lit) and the card host (feature-board)
         do not introduce margins that create a visible gap. */
      .timeline-section {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        margin: 0;
        padding: 0;
        border: 0;
        width: 100%;
        overflow: auto;
        cursor: grab;
        position: relative;
        z-index: 10;
        /* Alternating month background aligned with card lanes */
        background: repeating-linear-gradient(to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) calc(var(--timeline-month-width, 120px) * 2)
        );
        background-position: 0 0;
      }
      .timeline-section.panning { cursor: grabbing; }
      /* Header (months row) — let the timeline component size itself */
      .timeline-section > timeline-lit {
        flex: 0 0 auto;
        height: auto;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      /* Remove margins/padding that might come from child content */
      .timeline-section > timeline-lit, .timeline-section > timeline-lit * {
        margin: 0 !important;
        padding: 0 !important;
      }
      /* Card host must be flush under the header */
      .timeline-section > feature-board {
        margin: 0;
        padding: 0;
        border: 0;
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
      }
      /* make timeline header fixed height and let feature-board grow */
      .timeline-section > timeline-lit { flex: 0 0 20px; }
      .timeline-section > feature-board { display: block; flex: 1 1 auto; min-height: 0; overflow: auto; }
    `;
  }

  render() {
    return html`
      <style>
        .timeline-board-viewport {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
          background: var(--app-background, #fff);
          flex: 1 1 auto;
          min-height: 0;
        }
        .timeline-board-inner {
          min-width: 0;
          width: 100%;
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          position: relative;
          min-height: 0;
        }
      </style>
      <div class="timeline-board-viewport">
        <div class="timeline-board-inner">
          <section id="maingraphSection" class="panel maingraph-section" aria-label="Organisational Load Graph">
            <maingraph-lit></maingraph-lit>
          </section>
          <section id="timelineSection" class="panel timeline-section" aria-label="Timeline and Features">
            <timeline-lit></timeline-lit>
            <feature-board></feature-board>
          </section>
        </div>
      </div>
    `;
  }
}

customElements.define('timeline-board', TimelineBoard);
