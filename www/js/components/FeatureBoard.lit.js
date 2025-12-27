import { LitElement, html, css } from '../vendor/lit.js';
import { ProjectEvents, TeamEvents, TimelineEvents, FeatureEvents, FilterEvents, ScenarioEvents, ViewEvents, DragEvents } from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { getTimelineMonths } from './Timeline.lit.js';
import { formatDate, parseDate, addMonths } from './util.js';
import { laneHeight, computePosition, getBoardOffset, _test_resetCache } from './board-utils.js';
import { startDragMove, startResize } from './dragManager.js';
import { featureFlags } from '../config.js';

class FeatureBoard extends LitElement {
  static properties = {
    features: { type: Array }
  };

  constructor() {
    super();
    this.features = [];
    this._cardMap = new Map();
    this._busHandlers = [];
  }

  static styles = css`
    :host {
      display: block;
      flex: 1;
      position: relative;
      overflow: auto;
      padding: 0;
      /* Alternating month background aligned with card lanes */
      background:
        repeating-linear-gradient(to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) var(--timeline-month-width, 120px),
          var(--color-month-alt, #ececec) calc(var(--timeline-month-width, 120px) * 2)
        );
      background-position: 0 0; /* align stripes with card origin */
    }

    :host(.scenario-mode) {
      background:
        repeating-linear-gradient(to right,
          var(--color-bg, #f7f7f7) 0,
          var(--color-bg, #f7f7f7) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2) var(--timeline-month-width, 120px),
          var(--color-month-alt-scenario, #e2e2e2) calc(var(--timeline-month-width, 120px) * 2)
        );
      background-position: 0 0;
    }
  `;

  // Use shadow DOM so component-scoped `static styles` apply.
  // Render a slot so any existing light-DOM children (or imperative
  // appendChild calls) will still be projected into the component.

  connectedCallback(){
    super.connectedCallback();
    // Ensure accessible role is present on the host element
    try{ if(!this.hasAttribute('role')) this.setAttribute('role','list'); }catch(e){}
  }

  render(){
    if (!this.features || !this.features.length) {
      return html`<slot></slot>`;
    }
    return html`${this.features.map(fobj => html`<feature-card-lit
        .feature=${fobj.feature}
        .bus=${bus}
        .teams=${fobj.teams}
        .condensed=${fobj.condensed}
        .project=${fobj.project}
        style="position:absolute; left:${fobj.left}px; top:${fobj.top}px; width:${fobj.width}px"
      ></feature-card-lit>`)}
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // remove bus handlers
    try {
      for (const { event, handler } of this._busHandlers) bus.off(event, handler);
    } catch (e) {}
    this._busHandlers = [];
  }

  // Compute and render features from current state
  renderFeatures() {
    const sourceFeatures = state.getEffectiveFeatures();
    let ordered;
    if (state.featureSortMode === 'rank') {
      const epics = sourceFeatures.filter(f => f.type === 'epic').sort((a, b) => (a.originalRank || 0) - (b.originalRank || 0));
      const childrenByEpic = new Map();
      sourceFeatures.forEach(f => { if (f.type === 'feature' && f.parentEpic) { if (!childrenByEpic.has(f.parentEpic)) childrenByEpic.set(f.parentEpic, []); childrenByEpic.get(f.parentEpic).push(f); } });
      for (const arr of childrenByEpic.values()) arr.sort((a, b) => (a.originalRank || 0) - (b.originalRank || 0));
      const standalone = sourceFeatures.filter(f => f.type === 'feature' && !f.parentEpic).sort((a, b) => (a.originalRank || 0) - (b.originalRank || 0));
      ordered = [];
      for (const epic of epics) { ordered.push(epic); const kids = childrenByEpic.get(epic.id) || []; ordered.push(...kids); }
      ordered.push(...standalone);
    } else {
      const epics = sourceFeatures.filter(f => f.type === 'epic').sort((a, b) => a.start.localeCompare(b.start));
      const childrenByEpic = new Map();
      sourceFeatures.forEach(f => { if (f.type === 'feature' && f.parentEpic) { if (!childrenByEpic.has(f.parentEpic)) childrenByEpic.set(f.parentEpic, []); childrenByEpic.get(f.parentEpic).push(f); } });
      for (const arr of childrenByEpic.values()) arr.sort((a, b) => a.start.localeCompare(b.start));
      const standalone = sourceFeatures.filter(f => f.type === 'feature' && !f.parentEpic).sort((a, b) => a.start.localeCompare(b.start));
      ordered = [];
      for (const epic of epics) { ordered.push(epic); const kids = childrenByEpic.get(epic.id) || []; ordered.push(...kids); }
      ordered.push(...standalone);
    }

    let idx = 0;
    const mapChildren = new Map();
    sourceFeatures.forEach(f => { if (f.type === 'feature' && f.parentEpic) { if (!mapChildren.has(f.parentEpic)) mapChildren.set(f.parentEpic, []); mapChildren.get(f.parentEpic).push(f); } });
    const renderList = [];
    for (const f of ordered) {
      if (!state.projects.find(p => p.id === f.project && p.selected)) continue;
      const selStateSet = state.selectedFeatureStateFilter instanceof Set ? state.selectedFeatureStateFilter : new Set(state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []);
      if (selStateSet.size === 0) continue;
      const fState = f.status || f.state;
      if (!selStateSet.has(fState)) continue;
      if (f.type === 'epic' && !state.showEpics) continue;
      if (f.type === 'feature' && !state.showFeatures) continue;
      if (f.type === 'epic') {
        const kids = mapChildren.get(f.id) || [];
        const anyChildVisible = kids.some(ch => state.projects.find(p => p.id === ch.project && p.selected) && ch.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected)));
        const epicVisible = f.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected)) || anyChildVisible;
        if (!epicVisible) continue;
      } else {
        if (!f.capacity.some(tl => state.teams.find(t => t.id === tl.team && t.selected))) continue;
      }
      const months = getTimelineMonths();
      const pos = computePosition(f, months) || {};
      try { f._left = pos.left; f._width = pos.width; } catch (e) { }
      const left = (pos.left !== undefined ? pos.left : (f._left || f.left));
      const width = (pos.width !== undefined ? pos.width : (f._width || f.width));
      renderList.push({ feature: f, left, width, top: (idx * laneHeight()), teams: state.teams, condensed: state.condensedCards, project: state.projects.find(p => p.id === f.project) });
      idx++;
    }
    this.features = renderList;
    // schedule update so updated() runs after render
    this.requestUpdate();
  }

  // Update a subset of cards by id (keep compatibility with old function)
  async updateCardsById(ids = [], sourceFeatures = []) {
    try {
      // Build a map of existing nodes for requested ids to avoid repeated DOM queries
      const missingIds = new Set();
      const nodeById = new Map();
      // first check cache
      for (const id of ids) {
        const cached = this._cardMap.get(id);
        if (cached) nodeById.set(id, cached);
        else missingIds.add(id);
      }

      // Query DOM once for missing ids
      if (missingIds.size) {
        const candidatesA = this.shadowRoot ? Array.from(this.shadowRoot.querySelectorAll('feature-card-lit')) : [];
        const candidatesB = Array.from(this.querySelectorAll('feature-card-lit')) || [];
        const candidates = candidatesA.concat(candidatesB);
        for (const c of candidates) {
          try {
            const fid = c.feature && c.feature.id ? c.feature.id : (c.dataset && c.dataset.id);
            if (missingIds.has(fid)) {
              nodeById.set(fid, c);
              this._cardMap.set(fid, c);
              missingIds.delete(fid);
              if (missingIds.size === 0) break;
            }
          } catch (e) { }
        }
      }

      // Update nodes
      const months = getTimelineMonths();
      for (const id of ids) {
        const feature = state.getEffectiveFeatureById(id);
        if (!feature) continue;
        let geom = {};
        try {
          if (feature && feature._left !== undefined && feature._width !== undefined) { geom.left = feature._left; geom.width = feature._width; }
          else { geom = computePosition(feature, months) || {}; }
        } catch (e) { console.warn('computePosition failed', e); geom.left = feature && (feature._left || feature.left) || ''; geom.width = feature && (feature._width || feature.width) || ''; }
        const left = (geom.left !== undefined && geom.left !== '') ? (typeof geom.left === 'number' ? geom.left + 'px' : geom.left) : '';
        const width = (geom.width !== undefined && geom.width !== '') ? (typeof geom.width === 'number' ? geom.width + 'px' : geom.width) : '';

        const existing = nodeById.get(id);
        if (existing) {
          // minimize writes: only set style attributes when changed
          try {
            const proj = state.projects.find(p => p.id === feature.project);
            // Ensure the component receives the authoritative feature object first
            existing.feature = feature;
            existing.selected = !!feature.selected;
            existing.project = proj;
            // Clear any live-date overlay left from a drag/resize so the
            // lit-rendered default dates (bound to `feature.start/end`) become visible.
            //Moved to drag manager: existing.clearLiveDates();
            existing.applyVisuals({ left, width, selected: !!feature.selected, dirty: !!feature.dirty, project: proj });
          } catch (e) { }
        } else {
          // fallback to full render if node isn't present
          this.renderFeatures();
          break;
        }
      }
    } catch (e) { console.error('updateCardsById error', e); this.renderFeatures(); }
  }

  // after render, wire handlers and update _cardMap
  updated() {
    if (!this.shadowRoot) return;
    const cards = this.shadowRoot.querySelectorAll('feature-card-lit');
    let idx = 0;
    for (const node of cards) {
      const fobj = this.features[idx++] || {}; // best-effort
      try {
        // ensure styles and props in case template binding didn't set
        if (fobj.left !== undefined) node.style.left = fobj.left + 'px';
        if (fobj.top !== undefined) node.style.top = fobj.top + 'px';
        if (fobj.width !== undefined) node.style.width = fobj.width + 'px';
        node.feature = fobj.feature;
        node.bus = bus;
        node.teams = fobj.teams || state.teams;
        node.condensed = fobj.condensed || state.condensedCards;
        node.project = fobj.project || state.projects.find(p => p.id === (fobj.feature && fobj.feature.project));
      } catch (e) {}
      // Card component handles its own mousedown/drag/resize wiring.
      try { if (node.feature && node.feature.id) this._cardMap.set(node.feature.id, node); } catch (e) {}
    }
  }

  _selectFeature(feature){
    this.dispatchEvent(new CustomEvent('feature-selected', { detail: { feature }, bubbles: true, composed: true }));
  }

  // Convenience: append a DOM node or feature data (callers may use this)
  addFeature(nodeOrFeature){
    if(!nodeOrFeature) return;
    try{
      if(nodeOrFeature instanceof Node){ this.appendChild(nodeOrFeature); }
      else {
        const div = document.createElement('div'); div.className = 'feature'; div.setAttribute('role','listitem'); div.textContent = nodeOrFeature.title || 'Untitled'; this.appendChild(div);
      }
    }catch(e){}
  }
}

customElements.define('feature-board', FeatureBoard);

// --- Board-level rendering and helpers moved from FeatureCard.lit.js ---
// helpers moved to `board-utils.js`

// The board rendering is now encapsulated by the `feature-board` component.
// Call the component's instance methods (`renderFeatures`, `updateCardsById`) directly.

export async function initBoard() {
  bus.on(ProjectEvents.CHANGED, () => { const board = document.querySelector('feature-board'); if (board && typeof board.renderFeatures === 'function') board.renderFeatures(); });
  bus.on(TeamEvents.CHANGED, () => { const board = document.querySelector('feature-board'); if (board && typeof board.renderFeatures === 'function') board.renderFeatures(); });
  bus.on(TimelineEvents.MONTHS, () => { const board = document.querySelector('feature-board'); if (board && typeof board.renderFeatures === 'function') board.renderFeatures(); });
  bus.on(FeatureEvents.UPDATED, (payload) => {
    const board = document.querySelector('feature-board');
    const ids = payload && Array.isArray(payload.ids) && payload.ids.length ? payload.ids : null;
    if (board && typeof board.updateCardsById === 'function') {
      if (ids) { board.updateCardsById(ids, state.getEffectiveFeatures()); }
      else { board.renderFeatures(); }
    }
  });
  bus.on(FilterEvents.CHANGED, () => { const board = document.querySelector('feature-board'); if (board && typeof board.renderFeatures === 'function') board.renderFeatures(); });
  bus.on(ViewEvents.SORT_MODE, () => { const board = document.querySelector('feature-board'); if (board && typeof board.renderFeatures === 'function') board.renderFeatures(); });
  bus.on(ScenarioEvents.ACTIVATED, ({ scenarioId }) => {
    const board = document.querySelector('feature-board');
    if (!board) return;
    if (scenarioId !== 'baseline')
      board.classList.add('scenario-mode');
    else
      board.classList.remove('scenario-mode');
  });
  // initial render if element exists
  const board = document.querySelector('feature-board');
  if (board && typeof board.renderFeatures === 'function') board.renderFeatures();
}

