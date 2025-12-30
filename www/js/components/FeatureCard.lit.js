// www/js/components/FeatureCard.lit.js
// Lit 3.3.1 web component for feature cards

import { LitElement, html, css } from '../vendor/lit.js';
import { ProjectEvents, TeamEvents, TimelineEvents, FeatureEvents, FilterEvents, ScenarioEvents, ViewEvents, DragEvents } from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { startDragMove, startResize } from './dragManager.js';
import { featureFlags } from '../config.js';

/**
 * FeatureCardLit - Lit-based feature card component
 * @property {Object} feature - Feature data object
 * @property {Object} bus - EventBus instance for emitting events
 * @property {Array} teams - Array of team objects
 * @property {boolean} condensed - Whether to render in condensed mode
 * @property {boolean} selected - Whether this card is selected
 * @property {Object} project - Project object for border color
 */
export class FeatureCardLit extends LitElement {
  static properties = {
    feature: { type: Object },
    bus: { type: Object },
    teams: { type: Array },
    condensed: { type: Boolean },
    selected: { type: Boolean },
    project: { type: Object }
  };

  static styles = css`
    :host {
      display: block;
      position: absolute;
    }

    .feature-card {
      position: relative;
      background: white;
      border: 1px solid #ccc;
      border-left: 6px solid #666;
      border-radius: 6px;
      /* unified vertical padding so narrow and regular cards compute the same height */
      padding: 4px 8px;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      box-sizing: border-box;
      min-height: 40px;
      line-height: 1;
      transition: box-shadow 0.2s;
    }

    .feature-card:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    .feature-card.selected {
      /* match original shadow for selected cards */
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
    }

    .feature-card.dirty {
      /* Highlight entire card background for modified features (matches legacy look) */
      background: var(--color-dirty-bg, #ffe5c2);
      /* border-right: 4px solid var(--color-dirty-accent, #ffb84d); */
    }

    .feature-card.condensed {
      height: 40px;
      padding: 4px 8px;
    }

    /* Keep title font-size consistent across narrow/regular variants */
    .feature-title {
      font-size: 0.9em;
    }

    /* Compact layout for narrow cards: tighten spacing but keep content visible */
    .feature-card.narrow {
      height: auto;
      padding: 4px 8px;
      overflow: hidden;
      line-height: 1;
    }

    /* Keep team-load and dates visible; reduce vertical gaps */
    .feature-card .title-row {
      margin-bottom: 2px;
      align-items: center;
    }

    /* dirty badge shown for modified features in scenario mode */
    /*
    .dirty-badge {
      background: #ffb84d;
      color: #2b2b2b;
      padding: 2px 6px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
      margin-left: 6px;
    }
    */
   
    /* lightweight dates styling (keeps vertical gaps small) */
    .feature-dates {
      margin-top: 4px;
      margin-bottom: 0;
      font-size: 0.75em;
      line-height: 1;
      display: block;
    }

    .feature-card.culled .feature-title {
      display: none;
    }

    .team-load-row {
      display: flex;
      gap: 4px;
      margin-bottom: 2px;
      font-size: 0.75em;
    }

    .team-load-box {
      padding: 2px 4px;
      border-radius: 2px;
      color: white;
      font-weight: bold;
    }

    /* When narrow, clip the capacity row visually; */
    .feature-card.narrow .team-load-row {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .feature-card.selected .team-load-row {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    /* When fully culled, hide the capacity row entirely */
    .feature-card.culled .team-load-row { display: none; }

    .title-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 2px;
    }

    .feature-card-icon {
      flex-shrink: 0;
      font-size: 1.0em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
    }

    .feature-card-icon svg {
      width: 16px;
      height: 16px;
      color: #8b5cf6;
    }

    .feature-title {
      font-weight: bold;
      font-size: 0.9em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .feature-dates {
      font-size: 0.75em;
      color: #666;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      /* subtle fade to indicate truncation */
      position: relative;
      line-height: 1;
    }

    .feature-dates::after {
      content: '';
      position: absolute;
      right: 0;
      top: 0;
      width: 2.4em;
      height: 100%;
      pointer-events: none;
      background: linear-gradient(to right, rgba(255,255,255,0), rgba(255,255,255,1));
    }


    .drag-handle {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 10px;
      cursor: ew-resize;
      background: rgba(0,0,0,0.06);
      opacity: 0;
      transition: opacity 0.2s;
    }

    .feature-card:hover .drag-handle {
      opacity: 1;
    }
  `;

  constructor() {
    super();
    this.feature = {};
    this.bus = null;
    this.teams = [];
    this.condensed = false;
    this.selected = false;
    this.project = null;
    // ResizeObserver batching state
    this._ro = null;
    this._roQueue = [];
    this._roScheduled = false;
    this._skipRo = false; // set true while dragging to avoid layout reads
    this._abortController = new AbortController();
  }

  updated(changed) {
    // Reflect dirty state to inner card immediately so visual updates (resize/move) show the style
    const inner = this.shadowRoot?.querySelector?.('.feature-card');
    if (inner) inner.classList.toggle('dirty', this.feature.dirty);
    // reflect dirty on host as well for external styles/tests
    this.classList.toggle('dirty', this.feature?.dirty);
    this.setAttribute('data-feature-id', String(this.feature.id));
  }

  /**
   * Apply lightweight visual updates without forcing a full re-render.
   * Accepts CSS left/width values (strings with px or numbers), selection and dirty flags, and project info.
   */
  applyVisuals({ left, width, selected, dirty, project } = {}) {
    // Optional instrumentation
    if (featureFlags?.serviceInstrumentation) {
      console.log('[FeatureCard] applyVisuals', this.feature.id, { left, width, selected, dirty, project });
    }
    try {
      const px = typeof left === 'number' ? `${left}px` : left;
      this.style.left = px;
      const pxw = typeof width === 'number' ? `${width}px` : width;
      this.style.width = pxw;
      this.selected = selected;
      // immediate visual update for dirty flag to handle external visuals (drag/resize)
      this.feature = { ...this.feature, dirty };
      this.shadowRoot?.classList.toggle('dirty', dirty);
      // Also reflect dirty on host to support tests and external styles
      this.classList.toggle('dirty', dirty);
      this.project = project;
      // Force an update cycle if necessary
      this.requestUpdate();
    } catch (e) { /* swallow to allow caller fallback */ }
  }

  // Transient live-dates used during drag/resize to avoid writing directly
  // into text nodes that lit manages. Use `setLiveDates(text)` to show
  // a temporary date string; `clearLiveDates()` restores the lit-rendered value.
  setLiveDates(text) {
    try {
      const container = this.shadowRoot?.querySelector?.('.feature-dates');
      if (!container) return;
      const live = container.querySelector('.dates-live');
      const def = container.querySelector('.dates-default');
      if (live) { 
        live.textContent = text ?? ''; 
        live.style.display = text ? '' : 'none'; 
      }
      if (def) { 
        def.style.display = text ? 'none' : ''; 
      }
    } catch (e) { }
  }

  clearLiveDates() {
    this.setLiveDates('');
  }

  connectedCallback() {
    super.connectedCallback();
    // Debounced ResizeObserver: batch entries and process in rAF
    this._ro = new ResizeObserver(entries => {
      if (this._skipRo) return;
      for (const ent of entries) this._roQueue.push(ent);
      if (this._roScheduled) return;
      this._roScheduled = true;
      requestAnimationFrame(() => {
        this._roScheduled = false;
        this._processRoNow();
      });
    });

    // Delay initial observation to avoid running heavy layout reads during synchronous connectedCallback work
    requestAnimationFrame(() => { try { this._ro && this._ro.observe(this); } catch (e) { } });

    // Pause RO measurement during drag moves to avoid layout thrash; resume and process after drag end
    try {
      this._unsubDragMove = bus.on(DragEvents.MOVE, () => { this._skipRo = true; });
      this._unsubDragEnd = bus.on(DragEvents.END, () => { this._skipRo = false; this._processRoNow(); });
    } catch (e) { }
    // attach mousedown handlers for dragging and resizing directly on the host
    try {
      this.addEventListener('mousedown', this._onHostMouseDown = (e) => {
        const path = (e.composedPath && e.composedPath()) || [];
        const rh = this.shadowRoot && this.shadowRoot.querySelector('.drag-handle');
        const cameFromResizeHandle = path.includes(rh);
        if (cameFromResizeHandle) { e.stopPropagation(); const datesEl = this.shadowRoot && this.shadowRoot.querySelector('.feature-dates'); startResize(e, this.feature, this, datesEl, (updates) => state.updateFeatureDates(updates), state.getEffectiveFeatures()); return; }
        e.stopPropagation();
        const startX = e.clientX;
        this._boundOnPreMove = null;
        this._boundOnPreUp = null;
        const self = this;
        function onPreMove(ev) {
          const dx = ev.clientX - startX;
          if (Math.abs(dx) > 5) {
            try { if (self._boundOnPreMove) { window.removeEventListener('mousemove', self._boundOnPreMove); window.removeEventListener('pointermove', self._boundOnPreMove); self._boundOnPreMove = null; } } catch (e) {}
            try { if (self._boundOnPreUp) { window.removeEventListener('mouseup', self._boundOnPreUp); window.removeEventListener('pointerup', self._boundOnPreUp); self._boundOnPreUp = null; } } catch(e) {}
            startDragMove(e, self.feature, self, (updates) => state.updateFeatureDates(updates), state.getEffectiveFeatures());
          }
        }
        // bind with correct `this` for inside onPreMove and keep reference so it can be removed
        this._boundOnPreMove = onPreMove.bind(this);
        this._boundOnPreUp = (function onUp(ev){
          try {
            if (self._boundOnPreMove) {
              window.removeEventListener('mousemove', self._boundOnPreMove);
              window.removeEventListener('pointermove', self._boundOnPreMove);
              self._boundOnPreMove = null;
            }
          } catch (e) {}
          try {
            window.removeEventListener('mouseup', self._boundOnPreUp);
            window.removeEventListener('pointerup', self._boundOnPreUp);
            self._boundOnPreUp = null;
          } catch(e) {}
        }).bind(this);
        window.addEventListener('mousemove', this._boundOnPreMove);
        window.addEventListener('pointermove', this._boundOnPreMove);
        window.addEventListener('mouseup', this._boundOnPreUp);
        window.addEventListener('pointerup', this._boundOnPreUp);
      });
    } catch (e) {}
  }

  disconnectedCallback() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    try { if (typeof this._unsubDragMove === 'function') this._unsubDragMove(); } catch (e) { }
    try { if (typeof this._unsubDragEnd === 'function') this._unsubDragEnd(); } catch (e) { }
    try { if (this._onHostMouseDown) this.removeEventListener('mousedown', this._onHostMouseDown); } catch (e) {}
      try { if (this._boundOnPreUp) { window.removeEventListener('mouseup', this._boundOnPreUp); window.removeEventListener('pointerup', this._boundOnPreUp); this._boundOnPreUp = null; } } catch (e) {}
    super.disconnectedCallback();
  }

  _processRoNow() {
    if (this._skipRo) { this._roQueue = []; return; }
    // coalesce latest entry for this host
    const entry = this._roQueue.length ? this._roQueue[this._roQueue.length - 1] : null;
    this._roQueue = [];
    if (!entry) return;
    try {
      const rootCard = this.shadowRoot && this.shadowRoot.querySelector('.feature-card');
      if (!rootCard) return;
      const teamRow = rootCard.querySelector('.team-load-row');
      const titleEl = rootCard.querySelector('.feature-title');
      const tolerance = 2;

      // Use entry.contentRect.width (cheap) for host width; scrollWidth reads happen here but only once per rAF
      const w = entry.contentRect ? entry.contentRect.width : (rootCard.clientWidth || 0);
      const teamFits = teamRow ? (teamRow.scrollWidth <= (teamRow.clientWidth + tolerance)) : true;
      const titleFits = titleEl ? (titleEl.scrollWidth <= (titleEl.clientWidth + tolerance)) : true;
      const contentFits = teamFits && titleFits;

      if (contentFits) {
        rootCard.classList.remove('narrow');
        this.classList.remove('narrow');
      } else {
        rootCard.classList.add('narrow');
        this.classList.add('narrow');
      }

      if (w < 70) { rootCard.classList.add('culled'); this.classList.add('culled'); }
      else { rootCard.classList.remove('culled'); this.classList.remove('culled'); }
    } catch (e) { }
  }

  _handleClick(e) {
    // If the click originated from the resize handle, ignore it
    try {
      const path = (e.composedPath && e.composedPath()) || [];
      // path may include shadow DOM nodes; check for any element with class 'drag-handle'
      const cameFromHandle = path.some(p => p && p.classList && p.classList.contains && p.classList.contains('drag-handle'));
      if (cameFromHandle) return;
    } catch (err) { /* ignore path errors and continue */ }

    // If this click is part of a double-click it should be ignored (double-click handles revert)
    if (e.detail && e.detail === 2) {
      return;
    }

    // Emit the SELECTED events for other components to subscribe to.
    // Use the latest effective feature from state to ensure changedFields/dirty
    // are present for the details panel (handles queued optimistic updates).
    const eff = state.getEffectiveFeatureById(this.feature && this.feature.id) || this.feature;
    this.bus.emit(FeatureEvents.SELECTED, eff);
    if (featureFlags && featureFlags.serviceInstrumentation)
      console.log('[FeatureCardLit] emitted SELECTED for feature', this.feature.id, eff);
  }

  _handleDoubleClick(e) {
    // If the dblclick originated from the resize handle, ignore it
    try {
      const path = (e.composedPath && e.composedPath()) || [];
      const cameFromHandle = path.some(p => p && p.classList && p.classList.contains && p.classList.contains('drag-handle'));
      if (cameFromHandle) return;
    } catch (err) { /* ignore */ }

    try {
      // Revert changes for this feature via state service
      if (this.feature && this.feature.id) {
        state.revertFeature(this.feature.id);
        if (featureFlags && featureFlags.serviceInstrumentation) console.log('[FeatureCardLit] reverted feature', this.feature.id);
      }
    } catch (err) { /* swallow errors to avoid breaking UI */ }
  }

  _renderTeamLoadRow() {
    if (this.condensed) return '';

    const orgBox = html`
      <span class="team-load-box" style="background: #23344d;">
        ${this.feature.orgLoad || '0%'}
      </span>
    `;

    const teamBoxes = this.feature.capacity?.map(tl => {
      const team = this.teams?.find(t => t.id === tl.team && t.selected);
      if (!team) return null;
      return html`
        <span class="team-load-box" style="background: ${team.color};">
          ${tl.capacity}
        </span>
      `;
    }).filter(Boolean) || [];

    return html`
      <div class="team-load-row">
        ${orgBox}
        ${teamBoxes}
      </div>
    `;
  }

  _renderTypeIcon() {
    if (this.feature.type === 'epic') {
      return html`<span class="feature-card-icon epic">👑</span>`;
    }
    return html`
      <span class="feature-card-icon feature">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path fill="currentColor" d="M7 3h10v3c0 2.761-2.239 5-5 5s-5-2.239-5-5V3zm5 10c3.314 0 6-2.686 6-6V2H6v5c0 3.314 2.686 6 6 6zm-3.5 2h7a.5.5 0 01.5.5c0 .828-.672 1.5-1.5 1.5h-5a1.5 1.5 0 01-1.5-1.5.5.5 0 01.5-.5zm-1.75 4h11.5c.276 0 .5.224.5.5v1c0 .276-.224.5-.5.5H6.75a.5.5 0 01-.5-.5v-1c0-.276.224-.5.5-.5z"/>
        </svg>
      </span>
    `;
  }

  render() {
    const cardClasses = {
      'feature-card': true,
      'selected': this.selected,
      'dirty': this.feature.dirty,
      'condensed': this.condensed
    };

    const borderColor = this.project?.color || '#666';

    return html`
      <div 
        class=${Object.keys(cardClasses).filter(k => cardClasses[k]).join(' ')}
        data-id=${this.feature.id}
        style="border-left-color: ${borderColor};"
        role="listitem"
        draggable="false"
        @click=${this._handleClick}
        @dblclick=${this._handleDoubleClick}
        part="feature-card"
      >
        ${this._renderTeamLoadRow()}
        <div class="title-row">
          ${this._renderTypeIcon()}
          <div class="feature-title" title=${this.feature.title}>
            ${this.feature.title}
          </div>
        </div>
        ${!this.condensed ? html`
          <div class="feature-dates">
            <span class="dates-default">${this.feature.start} → ${this.feature.end}</span>
            <span class="dates-live" aria-hidden="true" style="display:none"></span>
          </div>
        ` : ''}
        <div class="drag-handle" data-drag-handle part="drag-handle"></div>
      </div>
    `;
  }
}

customElements.define('feature-card-lit', FeatureCardLit);
