// www/js/components/FeatureCard.lit.js
// Lit 3.3.1 web component for feature cards

import { LitElement, html, css } from '../vendor/lit.js';
import { ProjectEvents, TeamEvents, TimelineEvents, FeatureEvents, FilterEvents, ScenarioEvents, ViewEvents, DragEvents } from '../core/EventRegistry.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { getTimelineMonths } from './Timeline.lit.js';
import { formatDate, parseDate, addMonths } from './util.js';
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
    this._unsubDragMove = null;
    this._unsubDragEnd = null;
  }

  updated(changed) {
    // Reflect dirty state as a host class so external light-DOM logic and CSS can target it
    // TODO: Remove light DOM; use shadow DOM only
    try {
      const isDirty = !!(this.feature && this.feature.dirty);
      this.classList.toggle('dirty', isDirty);
      // Also apply to inner card immediately so visual updates (resize/move) show the style
      try {
        const rootCard = this.shadowRoot && this.shadowRoot.querySelector('.feature-card');
        if (rootCard) rootCard.classList.toggle('dirty', isDirty);
      } catch (e) { /* noop */ }
    } catch (e) {
      // no-op
    }
    try {
      if (this.feature && this.feature.id !== undefined && this.feature.id !== null) {
        this.setAttribute('data-feature-id', String(this.feature.id));
      } else {
        this.removeAttribute('data-feature-id');
      }
    } catch (e) { }
  }

  /**
   * Apply lightweight visual updates without forcing a full re-render.
   * Accepts CSS left/width values (strings with px or numbers), selection and dirty flags, and project info.
   */
  applyVisuals({ left, width, selected, dirty, project } = {}) {
    // Optional instrumentation
    if (featureFlags && featureFlags.serviceInstrumentation) {
      console.log('[FeatureCard] applyVisuals', this.feature.id, { left, width, selected, dirty, project });
    }
    try {
      const px = typeof left === 'number' ? left + 'px' : left;
      this.style.left = px;
      const pxw = typeof width === 'number' ? width + 'px' : width;
      this.style.width = pxw;
      this.selected = selected;
      // immediate visual update for dirty flag to handle external visuals (drag/resize)
      this.feature = Object.assign({}, this.feature, { dirty });
      this.shadowRoot.classList.toggle('dirty', dirty);
      this.project = project;
      // Force an update cycle if necessary
      this.requestUpdate();
    } catch (e) { /* swallow to allow caller fallback */ }
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
  }

  disconnectedCallback() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    try { if (typeof this._unsubDragMove === 'function') this._unsubDragMove(); } catch (e) { }
    try { if (typeof this._unsubDragEnd === 'function') this._unsubDragEnd(); } catch (e) { }
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
    console.log('FeatureCardLit _handleClick', e);
    try {
      const path = (e.composedPath && e.composedPath()) || [];
      // path may include shadow DOM nodes; check for any element with class 'drag-handle'
      const cameFromHandle = path.some(p => p && p.classList && p.classList.contains && p.classList.contains('drag-handle'));
      if (cameFromHandle) return;
    } catch (err) { /* ignore path errors and continue */ }

    // Emit the SELECTED events for other components to subscribe to.
    // Use the latest effective feature from state to ensure changedFields/dirty
    // are present for the details panel (handles queued optimistic updates).
    const eff = state.getEffectiveFeatureById(this.feature && this.feature.id);
    this.bus.emit(FeatureEvents.SELECTED, eff);
    if (featureFlags && featureFlags.serviceInstrumentation)
      console.log('[FeatureCardLit] emitted SELECTED for feature', this.feature.id, eff);
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
            ${this.feature.start} → ${this.feature.end}
          </div>
        ` : ''}
        <div class="drag-handle" data-drag-handle part="drag-handle"></div>
      </div>
    `;
  }
}

customElements.define('feature-card-lit', FeatureCardLit);

export function laneHeight() {
  return state.condensedCards ? 40 : 64;
}

export function getBoardOffset() {
  const board = typeof document !== 'undefined' ? document.querySelector('feature-board') : null;
  if (!board) return 0;
  const pl = parseInt(getComputedStyle(board).paddingLeft, 10);
  return isNaN(pl) ? 0 : pl;
}

const monthWidth = 120;

// Cached months-derived metadata to avoid repeated Date allocations when computing positions
let _cachedMonthsRef = null;
let _cachedMonthStarts = null; // array of ms timestamps for month starts
let _cachedMonthDays = null; // days per month

function _buildMonthCache(months) {
  _cachedMonthsRef = months;
  _cachedMonthStarts = months.map(m => m.getTime());
  _cachedMonthDays = months.map(m => new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate());
}

export function computePosition(feature, monthsArg) {
  const months = monthsArg || getTimelineMonths();
  if (!_cachedMonthsRef || _cachedMonthsRef.length !== months.length || (_cachedMonthsRef[0] && months[0] && _cachedMonthsRef[0].getTime() !== months[0].getTime())) {
    _buildMonthCache(months);
  }
  let startDate = parseDate(feature.start);
  let endDate = parseDate(feature.end);
  if (!(startDate instanceof Date) || isNaN(startDate.getTime())) startDate = new Date('2025-01-01');
  if (!(endDate instanceof Date) || isNaN(endDate.getTime())) endDate = new Date('2025-01-15');

  // Binary-search month index using cached month starts
  const ms = startDate.getTime();
  const ems = endDate.getTime();
  function findMonthIndexFor(msVal) {
    const arr = _cachedMonthStarts; let lo = 0, hi = arr.length - 1;
    if (msVal < arr[0]) return -1;
    if (msVal >= arr[hi]) return hi;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1; const midStart = arr[mid]; const midEnd = midStart + (_cachedMonthDays[mid] * 24 * 60 * 60 * 1000);
      if (msVal >= midStart && msVal < midEnd) return mid;
      if (msVal < midStart) hi = mid - 1; else lo = mid + 1;
    }
    return -1;
  }
  let startIdx = findMonthIndexFor(ms);
  if (startIdx < 0) startIdx = ms < _cachedMonthStarts[0] ? 0 : months.length - 1;
  let endIdx = findMonthIndexFor(ems);
  if (endIdx < 0) endIdx = ems < _cachedMonthStarts[0] ? 0 : months.length - 1;

  const startDays = _cachedMonthDays[startIdx];
  const endDays = _cachedMonthDays[endIdx];
  const startFraction = (startDate.getDate() - 1) / startDays;
  const endFraction = (endDate.getDate()) / endDays;

  const boardOffset = getBoardOffset();
  const left = boardOffset + (startIdx + startFraction) * monthWidth;
  const spanContinuous = (endIdx + endFraction) - (startIdx + startFraction);
  let width = spanContinuous * monthWidth;
  const minVisualWidth = 40;
  if (width < minVisualWidth) width = minVisualWidth;

  return { left, width };
}



// Map of currently rendered Lit feature cards keyed by feature id.
const litCardMap = new Map();

export function renderFeatureBoardLit(board) {
  let ordered;
  const sourceFeatures = state.getEffectiveFeatures();
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
  board.innerHTML = '';
  for (const f of ordered) {
    if (!state.projects.find(p => p.id === f.project && p.selected)) continue;
    const selStateSet = state.selectedStateFilter instanceof Set ? state.selectedStateFilter : new Set(state.selectedStateFilter ? [state.selectedStateFilter] : []);
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
    // cache visual geometry on the feature object to avoid recomputing repeatedly
    try { f._left = pos.left; f._width = pos.width; } catch (e) { }
    const left = (pos.left !== undefined ? pos.left : (f._left || f.left));
    const width = (pos.width !== undefined ? pos.width : (f._width || f.width));
    const card = document.createElement('feature-card-lit');
    card.style.left = left + 'px';
    card.style.top = (idx * laneHeight()) + 'px';
    card.style.width = width + 'px';
    card.feature = f;
    card.bus = bus;
    card.teams = state.teams;
    card.condensed = state.condensedCards;
    card.project = state.projects.find(p => p.id === f.project);
    const updateDatesCb = (updatesArray) => state.updateFeatureDates(updatesArray);
    const featuresSource = sourceFeatures;
    const resizeHandleQuery = () => card.shadowRoot?.querySelector('.drag-handle');
    const datesQuery = () => card.shadowRoot?.querySelector('.feature-dates');

    card.addEventListener('mousedown', e => {
      const path = (e.composedPath && e.composedPath()) || [];
      const rh = resizeHandleQuery();
      const cameFromResizeHandle = path.includes(rh);
      if (cameFromResizeHandle) { e.stopPropagation(); const datesEl = datesQuery(); startResize(e, f, card, datesEl, updateDatesCb, featuresSource); return; }
      e.stopPropagation();
      const startX = e.clientX;
      let isDragging = false;
      function onPreMove(ev) {
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > 5) {
          isDragging = true;
          window.removeEventListener('mousemove', onPreMove); window.removeEventListener('mouseup', onPreUp);
          startDragMove(e, f, card, updateDatesCb, featuresSource);
        }
      }
      function onPreUp() {
        console.log('FeatureCardLit pre-up, isDragging:', isDragging);
        window.removeEventListener('mousemove', onPreMove); window.removeEventListener('mouseup', onPreUp);
      }
      window.addEventListener('mousemove', onPreMove);
      window.addEventListener('mouseup', onPreUp);
    });
    const rh = resizeHandleQuery();
    if (rh) {
      rh.addEventListener('mousedown', e => {
        e.stopPropagation();
        const datesEl = datesQuery();
        startResize(e, f, card, datesEl, updateDatesCb, featuresSource);
      });
    }
    board.appendChild(card);
    try { litCardMap.set(f.id, card); } catch (e) { }
    if (featureFlags && featureFlags.serviceInstrumentation) {
        console.log('[FeatureBoard] created card', f.id, 'left:', left, 'width:', width, 'featureOverride:', f._left !== undefined || f._width !== undefined);
    }
    idx++;
  }
}

export async function updateCardsById(board, ids = [], sourceFeatures = []) {
  const getFeature = (id) => {
    if (Array.isArray(sourceFeatures)) return sourceFeatures.find((f) => f.id === id);
    if (sourceFeatures && typeof sourceFeatures.get === 'function') return sourceFeatures.get(id);
    return undefined;
  };
  try {
    for (const id of ids) {
      const feature = getFeature(id);
      if (!feature) continue;
      let geom = {};
      try {
        // Prefer cached values if present
        if (feature && feature._left !== undefined && feature._width !== undefined) { geom.left = feature._left; geom.width = feature._width; }
        else { const months = getTimelineMonths(); geom = computePosition(feature, months) || {}; }
      } catch (e) { console.warn('computePosition failed', e); geom.left = feature && (feature._left || feature.left) || ''; geom.width = feature && (feature._width || feature.width) || ''; }
      const left = (geom.left !== undefined && geom.left !== '') ? (typeof geom.left === 'number' ? geom.left + 'px' : geom.left) : '';
      const width = (geom.width !== undefined && geom.width !== '') ? (typeof geom.width === 'number' ? geom.width + 'px' : geom.width) : '';
      let existing = litCardMap.get(id);
      if (!existing && board) {
        const candidates = board.querySelectorAll('feature-card-lit');
        for (const c of candidates) { try { const fid = c.feature && c.feature.id ? c.feature.id : (c.dataset && c.dataset.id); if (fid === id) { existing = c; litCardMap.set(id, c); break; } } catch (e) { } }
      }
      if (existing) { if (typeof existing.applyVisuals === 'function') { existing.applyVisuals({ left, width, selected: !!feature.selected, dirty: !!feature.dirty, project: state.projects.find(p => p.id === feature.project) }); } else { existing.style.left = left; existing.style.width = width; existing.feature = feature; existing.selected = !!feature.selected; } }
      else {
        // Fallback: full render
        try { renderFeatureBoardLit(board); } catch (e) { console.error('updateCardsById fallback render failed', e); }
      }
    }
  } catch (e) { console.error('updateCardsById error', e); try { renderFeatureBoardLit(board); } catch (err) { } }
}

// Initialize feature cards wiring
export async function initFeatureCards() {
  bus.on(ProjectEvents.CHANGED, () => { const board = document.querySelector('feature-board'); if (board) renderFeatureBoardLit(board); });
  bus.on(TeamEvents.CHANGED, () => { const board = document.querySelector('feature-board'); if (board) renderFeatureBoardLit(board); });
  bus.on(TimelineEvents.MONTHS, () => { const board = document.querySelector('feature-board'); if (board) renderFeatureBoardLit(board); });
  bus.on(FeatureEvents.UPDATED, (payload) => {
    const board = document.querySelector('feature-board');
    const ids = payload && Array.isArray(payload.ids) && payload.ids.length ? payload.ids : null;
    if (ids) { updateCardsById(board, ids, state.getEffectiveFeatures()); }
    else { renderFeatureBoardLit(board); }
  });
  bus.on(FilterEvents.CHANGED, () => { const board = document.querySelector('feature-board'); if (board) renderFeatureBoardLit(board); });
  bus.on(ViewEvents.SORT_MODE, () => { const board = document.querySelector('feature-board'); if (board) renderFeatureBoardLit(board); });
  bus.on(ScenarioEvents.ACTIVATED, ({ scenarioId }) => {
    const board = document.querySelector('feature-board'); if (!board) return;
    if (scenarioId && scenarioId !== 'baseline') board.classList.add('scenario-mode'); else board.classList.remove('scenario-mode');
  });
  const board = document.querySelector('feature-board'); if (board) renderFeatureBoardLit(board);
}
