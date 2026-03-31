// www/js/components/FeatureCard.lit.js
// Lit 3.3.1 web component for feature cards

import { LitElement, html, css } from '../vendor/lit.js';
import { FeatureEvents, DragEvents, UIEvents } from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { startDragMove, startResize } from './dragManager.js';
import { epicTemplate, featureTemplate } from '../services/IconService.js';
import { featureFlags } from '../config.js';

/**
 * FeatureCardLit - Lit-based feature card component.
 * Each card self-manages layout classes and ghost title visibility
 * via a ResizeObserver - no board-level measurement needed.
 */
export class FeatureCardLit extends LitElement {
  static properties = {
    feature: { type: Object },
    bus: { type: Object },
    teams: { type: Array },
    condensed: { type: Boolean },
    selected: { type: Boolean },
    project: { type: Object },
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
      border-left: 4px solid var(--project-color, #ccc);
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
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .feature-card.selected {
      /* match original shadow for selected cards */
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    }

    /* Connected-set highlight: change background for stronger visibility.
       Ensure connected styling overrides dirty styling by matching both
       the host-level and inner .feature-card selectors and including
       the dirty combination. */
    :host(.connected) .feature-card,
    .feature-card.connected,
    .feature-card.connected.dirty,
    :host(.connected) .feature-card.dirty {
      background: var(--color-connected-bg, #e8f5ff);
      box-shadow: 0 2px 6px rgba(60, 120, 220, 0.08);
      transition:
        background 120ms ease,
        box-shadow 120ms ease;
    }

    /* Minimal highlight: small inset overlay that fades out */
    :host(.search-highlight) .feature-card::after {
      content: '';
      position: absolute;
      inset: 0px;
      border-radius: 6px;
      pointer-events: none;
      background: rgba(4, 63, 158, 0.9);
      opacity: 0; /* start invisible */
      z-index: 10;
      animation: search-bg-fade 900ms ease-out forwards;
    }

    @keyframes search-bg-fade {
      0% {
        opacity: 0;
      }
      20% {
        opacity: 0.85;
      }
      60% {
        opacity: 0.45;
      }
      100% {
        opacity: 0;
      }
    }

    .feature-card.dirty {
      /* Highlight entire card background for modified features (matches legacy look) */
      background: var(--color-dirty-bg, #ffe5c2);
      /* border-right: 4px solid var(--color-dirty-accent, #ffb84d); */
    }

    /* When a card is selected (clicked), highlight it in the viewport.
       This rule intentionally comes after the .dirty rule so the selected
       background overrides the dirty marker visual. */
    .feature-card.selected {
      background: var(--color-selected-bg, #dceeff);
      transition: background 180ms ease;
    }

    .feature-card.ghosted {
      /* Visual styling for unplanned features (no start/end dates) */
      opacity: 0.6;
      background: repeating-linear-gradient(
        45deg,
        #f8f8f8,
        #f8f8f8 10px,
        #efefef 10px,
        #efefef 20px
      );
      border-style: dashed;
      border-color: #999;
      /* Keep colored left border for plan identification even when ghosted */
      border-left-width: 4px;
      border-left-style: dashed;
      border-left-color: var(--project-color, #999);
    }

    .feature-card.ghosted:hover {
      opacity: 0.8;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
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
    /* Narrow layout: visually tighten spacing but preserve card height
       to avoid layout shifts between narrow and regular cards. */
    .feature-card.narrow {
      /* Do not change height here — keep the same height as regular cards. */
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

    /* Culled: hide title visually but preserve card height so boards
       remain aligned. Use visibility/opacity rather than display. */
    .feature-card.culled .feature-title {
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
    }

    .team-load-row {
      display: flex;
      gap: 4px;
      margin-bottom: 2px;
      font-size: 0.75em;
      /* Always constrain to card width to prevent overflow */
      max-width: 100%;
      overflow: hidden;
    }

    /* Dim capacity badges when the feature has children (parent contributions ignored) */
    .team-load-row.dimmed .team-load-box,
    .team-load-row.dimmed .team-load-box {
      opacity: 0.45;
      filter: grayscale(60%);
      transition:
        opacity 160ms ease,
        filter 160ms ease;
    }

    .dim-info {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 6px;
      font-size: 0.85em;
      color: rgba(0, 0, 0, 0.6);
      cursor: default;
      user-select: none;
    }
    .dim-info:hover {
      color: rgba(0, 0, 0, 0.85);
    }

    .team-load-box {
      padding: 2px 4px;
      border-radius: 2px;
      color: white;
      font-weight: bold;
      flex-shrink: 0;
    }

    /* When narrow, prevent wrapping and show ellipsis */
    .feature-card.narrow .team-load-row {
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .feature-card.selected .team-load-row {
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    /* When fully culled, visually hide the capacity row but preserve layout height */
    .feature-card.culled .team-load-row {
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
    }

    /* Small feature styling - for features <40px wide */
    .feature-card.small-feature {
      min-width: 8px !important;
      /* Make small features visually compact while preserving alignment
         Use a smaller min-height and reduced vertical padding (~32px total) */
      min-height: 32px;
      padding: 2px 6px;
      overflow: hidden;
      cursor: pointer;
    }

    /* Hide most internal content visually but keep the title-row visible
       so the small-feature indicator can occupy its space without adding
       an extra line. */
    .feature-card.small-feature .team-load-row,
    .feature-card.small-feature .feature-dates,
    .feature-card.small-feature .drag-handle {
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
    }

    /* Keep the title-row itself visible for layout, but hide its children
       (icon and title) so the indicator appears in-place. */
    .feature-card.small-feature .title-row > *:not(.small-feature-indicator) {
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
    }

    .small-feature-indicator {
      display: none; /* Hidden by default */
      width: 100%;
      height: 100%;
      align-items: center;
      justify-content: center;
      min-height: 24px;
    }

    .feature-card.small-feature .small-feature-indicator {
      display: flex; /* Only show for small features */
    }

    .small-feature-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.8;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 2px;
    }

    .feature-card-icon {
      flex-shrink: 0;
      font-size: 1em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
    }

    .feature-card-icon svg {
      width: 16px;
      height: 16px;
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
      background: linear-gradient(
        to right,
        rgba(255, 255, 255, 0),
        rgba(255, 255, 255, 1)
      );
    }

    .drag-handle {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 10px;
      cursor: ew-resize;
      background: rgba(0, 0, 0, 0.06);
      opacity: 0;
      transition: opacity 0.2s;
    }

    .feature-card:hover .drag-handle {
      opacity: 1;
    }

    /* Inline ghost title placed to the left of the card. Rendered inside
       the FeatureCard so no external coordinate math is required. */
    .ghost-title {
      position: absolute;
      right: 100%;
      margin-right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: 1px dashed rgba(0, 0, 0, 0.25);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      color: rgba(0, 0, 0, 0.75);
      z-index: 120;
      pointer-events: none;
      line-height: 1.1;
      text-align: left;
      white-space: nowrap;
      visibility: hidden;
      opacity: 0;
      transition: opacity 150ms ease-in-out;
      max-width: none;
      box-sizing: border-box;
    }

    /* If the card is too close to the left edge, place the ghost to the right side */
    .ghost-title.right {
      left: 100%;
      right: auto;
      margin-left: 12px;
      margin-right: 0;
    }

    :host(.ghost-visible) .ghost-title {
      visibility: visible;
      opacity: 1;
    }

    .ghost-title .ghost-title-text {
      display: inline-block;
      white-space: nowrap;
    }

    .ghost-title .ghost-title-arrow {
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

  constructor() {
    super();
    this.feature = {};
    this.bus = null;
    this.teams = [];
    this.condensed = false;
    this.selected = false;
    this.project = null;
    this._suppressClickUntil = 0;
    this._rootCard = null;
    this._titleEl = null;
    this._ghostEl = null;
    this._width = 0; // cached from ResizeObserver — no DOM read needed
    this._lastTitle = null; // track title changes for overflow re-check
    this._connected = false; // whether this card is in current connected set
  }

  // ---- Static batched layout scheduler ----
  // Collects all cards needing layout, then does ALL reads in one pass
  // followed by ALL writes — exactly one forced reflow per batch.
  static _pendingCards = new Set();
  static _batchScheduled = false;

  static _scheduleBatch() {
    if (FeatureCardLit._batchScheduled) return;
    FeatureCardLit._batchScheduled = true;
    requestAnimationFrame(() => {
      FeatureCardLit._batchScheduled = false;
      const cards = Array.from(FeatureCardLit._pendingCards);
      FeatureCardLit._pendingCards.clear();

      // --- Read phase (one forced reflow, then all reads are cached) ---
      const results = [];
      for (const card of cards) {
        const rootCard = card._rootCard;
        if (!rootCard) continue;
        const w = card._width;
        const isSmall = w < 40;
        let titleOverflows = isSmall;
        if (!isSmall) {
          if (!card._titleEl) card._titleEl = rootCard.querySelector('.feature-title');
          const titleEl = card._titleEl;
          if (titleEl) {
            titleOverflows = titleEl.scrollWidth > titleEl.clientWidth + 2;
          }
        }
        results.push({
          card,
          rootCard,
          w,
          isSmall,
          isCulled: w < 70,
          titleOverflows,
        });
      }

      // --- Write phase (no reads after this point) ---
      for (const r of results) {
        r.rootCard.classList.toggle('small-feature', r.isSmall);
        r.rootCard.classList.toggle('culled', r.isCulled);
        r.rootCard.classList.toggle('narrow', r.titleOverflows && !r.isSmall);
        r.card.classList.toggle('ghost-visible', r.titleOverflows);
        r.card.classList.toggle('title-overflow', r.titleOverflows);

        if (r.titleOverflows) {
          if (!r.card._ghostEl)
            r.card._ghostEl = r.card.shadowRoot?.querySelector('.ghost-title');
          const g = r.card._ghostEl;
          if (g) {
            const textNode = g.querySelector('.ghost-title-text');
            if (textNode) {
              try {
                textNode.innerHTML = r.card._splitTitleAtMiddle(r.card.feature?.title);
              } catch (e) {
                textNode.textContent = r.card.feature?.title || '';
              }
            }
            // Use style.left (set by board) instead of offsetLeft to avoid forced reflow
            g.classList.toggle('right', (parseFloat(r.card.style.left) || 0) < 200);
            g.style.borderColor = r.card.project?.color || 'rgba(0,0,0,0.25)';
          }
        }
      }
    });
  }

  _requestLayout() {
    // Skip if ResizeObserver hasn't delivered a real width yet.
    // Prevents the first batch (triggered by updated()) from running
    // with _width=0 and incorrectly showing ghosts on every card.
    if (this._width === 0) return;
    FeatureCardLit._pendingCards.add(this);
    FeatureCardLit._scheduleBatch();
  }

  connectedCallback() {
    super.connectedCallback();
    // ResizeObserver provides width via contentRect — no DOM read needed.
    // Callback adds this card to the batched layout scheduler.
    this._ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this._width = entry.contentRect.width;
      }
      this._requestLayout();
    });
    this._ro.observe(this);
    // Re-render when feature data updates
    this._unsubFeaturesUpdated = bus.on(FeatureEvents.UPDATED, () => {
      try {
        this.requestUpdate();
      } catch (e) {}
    });
    // Suppress clicks after drag ends
    this._unsubDragEnd = bus.on(DragEvents.END, (p) => {
      if (p && String(p.featureId) === String(this.feature?.id)) {
        this._suppressClickUntil = Date.now() + 250;
      }
    });
    // Mouse handler for drag and resize
    this._onMouseDown = this._handleMouseDown.bind(this);
    this.addEventListener('mousedown', this._onMouseDown);
    // Keep card deselected when another feature is selected elsewhere
    this._boundOnFeatureSelected = (f) => {
      const selId = f && f.id ? String(f.id) : null;
      const myId = String(this.feature?.id);
      if (!selId || myId !== selId) {
        if (this.selected) {
          this.selected = false;
          this.requestUpdate();
        }
      }
    };
    try {
      bus.on(FeatureEvents.SELECTED, this._boundOnFeatureSelected);
    } catch (e) {}
    // Listen for connected-set updates from the board
    this._boundOnConnectedSet = (payload) => {
      const ids = payload && payload.ids ? payload.ids : null;
      this._connectedPrimary =
        payload && payload.primary ? String(payload.primary) : null;
      this._connectedCurrent =
        payload && payload.current ? String(payload.current) : null;
      const id = String(this.feature.id);
      const inSet = Array.isArray(ids) ? ids.indexOf(id) !== -1 : false;
      if (inSet !== this._connected) {
        this._connected = inSet;
        this.classList.toggle('connected', inSet);
        const root = this._rootCard || this.shadowRoot?.querySelector('.feature-card');
        if (root) root.classList.toggle('connected', inSet);
        this.classList.toggle('dirty', !!this.feature?.dirty);
        this.requestUpdate();
      }
    };
    bus.on(FeatureEvents.CONNECTED_SET_UPDATED, this._boundOnConnectedSet);
    // Also clear highlight when details panel hides
    this._boundOnDetailsHide = () => {
      try {
        if (this.selected) {
          this.selected = false;
          this.requestUpdate();
        }
      } catch (e) {}
    };
    try {
      bus.on(UIEvents.DETAILS_HIDE, this._boundOnDetailsHide);
    } catch (e) {}
  }

  firstUpdated() {
    this._rootCard = this.shadowRoot?.querySelector('.feature-card');
  }

  updated() {
    if (!this._rootCard) this._rootCard = this.shadowRoot?.querySelector('.feature-card');
    const inner = this._rootCard;
    if (inner) inner.classList.toggle('dirty', !!this.feature?.dirty);
    this.classList.toggle('dirty', !!this.feature?.dirty);
    this.setAttribute('data-feature-id', String(this.feature?.id));
    // Only schedule a layout check when title text changes.
    // Width changes are handled by ResizeObserver (no action needed here).
    const title = this.feature?.title;
    if (title !== this._lastTitle) {
      this._lastTitle = title;
      this._requestLayout();
    }
  }

  disconnectedCallback() {
    FeatureCardLit._pendingCards.delete(this);
    this._ro?.disconnect();
    try {
      this._unsubFeaturesUpdated?.();
    } catch (e) {}
    try {
      this._unsubDragEnd?.();
    } catch (e) {}
    this.removeEventListener('mousedown', this._onMouseDown);
    try {
      if (this._boundOnFeatureSelected)
        bus.off(FeatureEvents.SELECTED, this._boundOnFeatureSelected);
    } catch (e) {}
    if (this._boundOnConnectedSet)
      bus.off(FeatureEvents.CONNECTED_SET_UPDATED, this._boundOnConnectedSet);
    if (this._boundOnDetailsHide)
      bus.off(UIEvents.DETAILS_HIDE, this._boundOnDetailsHide);
    if (this._boundOnPreMove) {
      window.removeEventListener('mousemove', this._boundOnPreMove);
      window.removeEventListener('pointermove', this._boundOnPreMove);
    }
    if (this._boundOnPreUp) {
      window.removeEventListener('mouseup', this._boundOnPreUp);
      window.removeEventListener('pointerup', this._boundOnPreUp);
    }
    super.disconnectedCallback();
  }

  /**
   * Apply lightweight visual updates without a full re-render.
   * Called by FeatureBoard.updateCardsById() for incremental updates.
   */
  applyVisuals({ left, width, selected, dirty, project } = {}) {
    if (left !== undefined)
      this.style.left = typeof left === 'number' ? `${left}px` : left;
    if (width !== undefined)
      this.style.width = typeof width === 'number' ? `${width}px` : width;
    if (selected !== undefined) this.selected = selected;
    if (dirty !== undefined && this.feature) this.feature.dirty = dirty;
    if (project !== undefined) this.project = project;
    this.classList.toggle('dirty', !!dirty);
    this.requestUpdate();
  }

  // Transient live-dates used during drag/resize
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
    } catch (e) {}
  }

  clearLiveDates() {
    this.setLiveDates('');
  }

  _handleMouseDown(e) {
    const rootCard = this._rootCard || this.shadowRoot?.querySelector('.feature-card');
    if (rootCard?.classList.contains('small-feature')) return;

    const path = (e.composedPath && e.composedPath()) || [];
    const rh = this.shadowRoot?.querySelector('.drag-handle');
    if (path.includes(rh)) {
      e.stopPropagation();
      const datesEl = this.shadowRoot?.querySelector('.feature-dates');
      startResize(
        e,
        this.feature,
        this,
        datesEl,
        (updates) => state.updateFeatureDates(updates),
        state.getEffectiveFeatures()
      );
      return;
    }

    e.stopPropagation();
    const startX = e.clientX;
    const self = this;

    const onPreMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 5) {
        cleanup();
        startDragMove(
          e,
          self.feature,
          self,
          (updates) => state.updateFeatureDates(updates),
          state.getEffectiveFeatures()
        );
      }
    };
    const onPreUp = () => cleanup();
    const cleanup = () => {
      window.removeEventListener('mousemove', onPreMove);
      window.removeEventListener('pointermove', onPreMove);
      window.removeEventListener('mouseup', onPreUp);
      window.removeEventListener('pointerup', onPreUp);
      self._boundOnPreMove = null;
      self._boundOnPreUp = null;
    };

    this._boundOnPreMove = onPreMove;
    this._boundOnPreUp = onPreUp;
    window.addEventListener('mousemove', onPreMove);
    window.addEventListener('pointermove', onPreMove);
    window.addEventListener('mouseup', onPreUp);
    window.addEventListener('pointerup', onPreUp);
  }

  _handleClick(e) {
    if (this._suppressClickUntil && Date.now() < this._suppressClickUntil) return;
    try {
      const path = (e.composedPath && e.composedPath()) || [];
      if (path.some((p) => p?.classList?.contains?.('drag-handle'))) return;
    } catch (err) {}
    if (e.detail === 2) return;

    const eff = state.getEffectiveFeatureById(this.feature?.id) || this.feature;
    if (state.highlightFeatureRelationMode) {
      // If this card is in the current connected set, treat it as selecting
      // the item within the set (highlight previous selection and new selection)
      if (this._connected) {
        this.bus.emit(FeatureEvents.SELECTED_IN_CONNECTED_SET, eff);
        this.selected = true;
        this.requestUpdate();
        return;
      }

      // Otherwise request the board to build and store a connected map for this feature
      this.bus.emit(FeatureEvents.REQUEST_CONNECTED_SET, eff);
    }
    // Also reflect selection locally
    this.selected = true;
    this.requestUpdate();
    this.bus.emit(FeatureEvents.SELECTED, eff);
  }

  _handleDoubleClick(e) {
    try {
      const path = (e.composedPath && e.composedPath()) || [];
      if (path.some((p) => p?.classList?.contains?.('drag-handle'))) return;
    } catch (err) {}
    try {
      if (this.feature?.id) state.revertFeature(this.feature.id);
    } catch (err) {}
  }

  _renderTeamLoadRow() {
    if (this.condensed) return '';
    const hasChildren = (() => {
      try {
        const map =
          state._dataInitService?.getChildrenByEpicMap?.() || state.childrenByEpic;
        const arr = map?.get?.(this.feature.id);
        return Array.isArray(arr) && arr.length > 0;
      } catch (e) {
        return false;
      }
    })();

    const orgBox = html`
      <span class="team-load-box" style="background: #23344d;" title="Organization load">
        ${this.feature.orgLoad || '0%'}
      </span>
    `;

    const teamBoxes =
      this.feature.capacity
        ?.map((tl) => {
          const team = this.teams?.find((t) => t.id === tl.team && t.selected);
          if (!team) return null;
          return html`
            <span
              class="team-load-box"
              style="background: ${team.color};"
              title="${team.name}: ${tl.capacity}"
            >
              ${tl.capacity}
            </span>
          `;
        })
        .filter(Boolean) || [];

    return html`
      <div
        class="team-load-row ${hasChildren ? 'dimmed' : ''}"
        title=${hasChildren ?
          'This feature has child items; using allocations from children in calculations'
        : ''}
      >
        ${hasChildren ?
          html`<span class="dim-info" role="img" style="font-size: 16px">ℹ️</span>`
        : ''}
        ${orgBox} ${teamBoxes}
      </div>
    `;
  }

  _renderTypeIcon() {
    if (this.feature.type === 'epic') {
      return html`<span class="feature-card-icon epic">${epicTemplate}</span>`;
    }
    return html`<span class="feature-card-icon feature">${featureTemplate}</span>`;
  }

  _splitTitleAtMiddle(title) {
    if (!title) return '';
    const words = String(title).split(/\s+/);
    if (words.length < 4) return title;
    const mid = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, mid).join(' ');
    const secondHalf = words.slice(mid).join(' ');
    return `${this._escapeHtml(firstHalf)}<br/>${this._escapeHtml(secondHalf)}`;
  }

  _escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  render() {
    const isUnplanned =
      featureFlags.SHOW_UNPLANNED_WORK && (!this.feature.start || !this.feature.end);
    const projectColor = this.project?.color || '#ccc';

    const cardClasses = {
      'feature-card': true,
      selected: this.selected,
      dirty: this.feature.dirty,
      condensed: this.condensed,
      ghosted: isUnplanned,
    };

    return html`
      <div
        class=${Object.keys(cardClasses)
          .filter((k) => cardClasses[k])
          .join(' ')}
        data-id=${this.feature.id}
        role="listitem"
        draggable="false"
        style="--project-color: ${projectColor}"
        @click=${this._handleClick}
        @dblclick=${this._handleDoubleClick}
        part="feature-card"
      >
        ${this._renderTeamLoadRow()}
        <div class="title-row">
          <div class="small-feature-indicator">
            <span class="small-feature-dot"></span>
          </div>
          ${this._renderTypeIcon()}
          <div class="feature-title" title=${this.feature.title}>
            ${this.feature.title}
          </div>
        </div>
        ${!this.condensed ?
          html`
            <div class="feature-dates">
              <span class="dates-default"
                >${this.feature.start} → ${this.feature.end}</span
              >
              <span class="dates-live" aria-hidden="true" style="display:none"></span>
            </div>
          `
        : ''}
        <div class="drag-handle" data-drag-handle part="drag-handle"></div>
      </div>
      <div class="ghost-title" aria-hidden="true">
        <span class="ghost-title-text"></span>
        <div class="ghost-title-arrow"></div>
      </div>
    `;
  }
}

customElements.define('feature-card-lit', FeatureCardLit);
