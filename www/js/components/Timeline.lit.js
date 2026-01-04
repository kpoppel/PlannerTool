// www/js/components/Timeline.lit.js
// Lit 3.3.1 web component for timeline header

import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents, TimelineEvents } from '../core/EventRegistry.js';
import { parseDate, addMonths, dateRangeInclusiveMonths } from './util.js';
import { featureFlags } from '../config.js';

// Timeline rendering config (kept here to centralize cross-module use)
export const TIMELINE_CONFIG = {
  monthWidth: 120,
  teamLineWidth: 2,
  teamLineOpacity: 0.9,
  overloadBgAlpha: 0.18,
  overloadBgColor: '#ff3b30'
};

let monthsCache = [];
let didInitialScroll = false;
let timelineElement = null; // Reference to mounted component instance

/**
 * Timeline - Lit-based timeline component
 * @property {Array} months - Array of Date objects representing months to display
 * @property {Object} bus - EventBus instance for emitting events
 * @property {number} monthWidth - Width of each month cell in pixels (default: 120)
 */
export class Timeline extends LitElement {
  static properties = {
    months: { type: Array },
    bus: { type: Object },
    monthWidth: { type: Number }
  };

  constructor() {
    super();
    this.months = [];
    this.bus = null;
    this.monthWidth = 120; // Default matches TIMELINE_CONFIG.monthWidth
  }

  static styles = css`
    :host {
      display: block;
    }

    .timeline-cell {
      flex: 0 0 auto;
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
    }

    /* Subtle translucent stripe pattern for the header (matches global look) */
    .timeline-header {
      display: flex;
      color: #fff;
      padding-top: 6px;
      padding-bottom: 6px;
      font-weight: bold;
      font-size: 0.85rem;
      background: repeating-linear-gradient(to right,
        rgba(255,255,255,0.04) 0,
        rgba(255,255,255,0.04) var(--timeline-month-width, 120px),
        rgba(255,255,255,0) var(--timeline-month-width, 120px),
        rgba(255,255,255,0) calc(var(--timeline-month-width, 120px) * 2)
      ),
      var(--color-sidebar-bg, #23344d);
    }
  `;

  render() {
    return html`
      <div 
        class="timeline-header" 
        style="width: ${this.getTotalWidth()}px;"
        role="rowgroup"
        aria-label="Timeline months"
      >
        ${this.months.map(month => this._renderMonthCell(month))}
      </div>
    `;
  }

  _renderMonthCell(month) {
    const label = month.toLocaleString('default', {
      month: 'short',
      year: '2-digit'
    });

    return html`
      <div 
        class="timeline-cell" 
        style="width: ${this.monthWidth}px; flex: 0 0 ${this.monthWidth}px;"
        role="columnheader"
        aria-label="${month.toLocaleString('default', { month: 'long', year: 'numeric' })}"
      >
        ${label}
      </div>
    `;
  }

  /**
   * Public API: Update months and re-render
   * @param {Array} newMonths - Array of Date objects
   */
  async renderMonths(newMonths) {
    const oldMonths = this.months ?? [];
    const nextMonths = newMonths ?? [];
    // shallow compare by length and first/last timestamps to avoid expensive re-renders
    let same = false;
    if(oldMonths.length === nextMonths.length){
      const oldFirst = oldMonths[0]?.getTime();
      const newFirst = nextMonths[0]?.getTime();
      const oldLast = oldMonths[oldMonths.length-1]?.getTime();
      const newLast = nextMonths[nextMonths.length-1]?.getTime();
      same = (oldFirst === newFirst && oldLast === newLast);
    }
    this.months = nextMonths;
    if(!same){
      this.requestUpdate('months', oldMonths);
      await this.updateComplete;
    }
    
    // Emit event after render completes
    this.bus?.emit?.(TimelineEvents.MONTHS, this.months);
  }

  updated(changedProperties) {
    super.updated(changedProperties);
  }

  /**
   * Public API: Scroll to a specific month index
   * @param {number} index - Month index to scroll to
   * @returns {Object} - Object with scrollLeft value for external scroll container
   */
  scrollToMonth(index) {
    const scrollLeft = index * this.monthWidth;
    return { scrollLeft };
  }

  /**
   * Get the total width of the timeline
   * @returns {number} - Total width in pixels
   */
  getTotalWidth() {
    return this.months.length * this.monthWidth;
  }
}

// Register the custom element
customElements.define('timeline-lit', Timeline);

// ------- Timeline adapter API (replaces legacy ../timeline.js) -------

function computeRange(){
  const feats = state.getEffectiveFeatures?.() ?? state.features ?? [];
  if(!feats?.length){ 
    const today = new Date(); 
    return { min: today, max: addMonths(today, 6) }; 
  }
  
  // Filter out unplanned features (those without dates) when SHOW_UNPLANNED_WORK is true
  const plannedFeats = featureFlags.SHOW_UNPLANNED_WORK 
    ? feats.filter(f => f.start && f.end)
    : feats;
  
  if(!plannedFeats?.length){ 
    const today = new Date(); 
    return { min: today, max: addMonths(today, 6) }; 
  }
  
  // Find first valid date to initialize min/max
  let min = null;
  let max = null;
  
  for(const f of plannedFeats){ 
    const s = parseDate(f.start); 
    const e = parseDate(f.end);
    
    // Skip features with invalid dates
    if(!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) continue;
    
    if(!min || s < min) min = s;
    if(!max || e > max) max = e;
  }
  
  // If no valid dates found, fall back to today
  if(!min || !max){
    const today = new Date(); 
    return { min: today, max: addMonths(today, 6) }; 
  }
  
  min = addMonths(min, -1); 
  max = addMonths(max, 2); 
  return {min, max};
}

function ensureComponentMounted(header){
  if(!timelineElement){
    // If the header argument is already a timeline-lit element, use it directly
    if(header?.tagName?.toLowerCase() === 'timeline-lit'){
      timelineElement = header;
    } else {
      // prefer existing element in DOM under the header or globally
      timelineElement = header?.querySelector?.('timeline-lit') ?? document.querySelector('timeline-lit');
      if(!timelineElement && customElements.get('timeline-lit')){
        timelineElement = document.createElement('timeline-lit');
        timelineElement.bus = bus;
        timelineElement.monthWidth = TIMELINE_CONFIG.monthWidth;
        if(header?.appendChild){ 
          header.innerHTML = ''; 
          header.appendChild(timelineElement); 
        }
        header?.classList?.remove('timeline-header');
        if(header?.style){ 
          header.style.position = 'sticky'; 
          header.style.top='0'; 
          header.style.zIndex='10'; 
          header.style.padding='0'; 
          header.style.background='transparent'; 
        }
      }
    }
  }
  return timelineElement;
}

export function getTimelineMonths(){ return monthsCache; }

export async function initTimeline(){
  // If Lit components disabled, nothing to mount here — callers should import component module directly
  try{
    // Wire up events. renderTimelineHeader accepts an optional payload so that
    // callers can provide changed ids and allow the header logic to short-circuit
    // when the visible month range does not need to change.
    bus.on(FeatureEvents.UPDATED, (p) => scheduleRenderTimelineHeader(p));
    bus.on(TimelineEvents.SCALE_CHANGED, (p) => scheduleRenderTimelineHeader(p));
    window.addEventListener('resize', () => { requestAnimationFrame(() => scheduleRenderTimelineHeader()); });
    enableTimelinePanning();
    // initial render
    renderTimelineHeader();
  }catch(e){ console.warn('[timeline-lit adapter] init failed', e); }
}

function renderTimelineHeader(payload){
  const shouldInstrument = featureFlags?.timelineInstrumentation;
  let t0;
  if(shouldInstrument && typeof performance !== 'undefined' && performance.now) t0 = performance.now();
  const header = document.querySelector('timeline-lit'); 
  if(!header) return;

  // If a payload with changed feature ids is provided, and we already have a
  // monthsCache, do a cheap check of only the changed features to determine
  // whether any of them fall outside the current month range. If none do,
  // we can skip recomputing months and avoid a header re-render.
  if (monthsCache?.length && payload?.ids?.length) {
    try{
      const feats = state.getEffectiveFeatures?.() ?? state.features ?? [];
      const firstMonthStart = monthsCache[0].getTime();
      const lastMonth = monthsCache[monthsCache.length - 1];
      const afterLastMonth = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 1).getTime();
      let needsRecalc = false;
      for (const id of payload.ids){
        const f = feats.find(x => x.id === id);
        if(!f) continue;
        const s = parseDate(f.start);
        const e = parseDate(f.end);
        if(!(s instanceof Date) || isNaN(s.getTime()) || !(e instanceof Date) || isNaN(e.getTime())){ 
          needsRecalc = true; 
          break; 
        }
        const ms = s.getTime(); 
        const ems = e.getTime();
        if(ms < firstMonthStart || ems >= afterLastMonth){ 
          needsRecalc = true; 
          break; 
        }
      }
      if(!needsRecalc){
        return; // nothing that affects the header's month span
      }
    }catch(e){ /* on error, fall through and recompute months */ }
  }

  const {min, max} = computeRange(); 
  let baseMonths = dateRangeInclusiveMonths(min, max);
  
  // Check if the month range changed significantly (different start/end months)
  const rangeChanged = monthsCache.length === 0 || 
    monthsCache[0].getTime() !== baseMonths[0].getTime() ||
    monthsCache[monthsCache.length - 1].getTime() !== baseMonths[baseMonths.length - 1].getTime();
  
  // Reset scroll flag if range changed so we re-scroll to today
  if(rangeChanged){
    didInitialScroll = false;
  }
  
  // Ensure months fill the visible timeline width so header spans entire card area
  const monthWidth = TIMELINE_CONFIG.monthWidth;
  const section = document.getElementById('timelineSection');
  if(section){
    const targetWidth = section.clientWidth;
    const needed = Math.ceil(targetWidth / monthWidth);
    if(baseMonths.length < needed){
      let last = baseMonths[baseMonths.length-1];
      while(baseMonths.length < needed){ 
        last = addMonths(last, 1); 
        baseMonths.push(new Date(last)); 
      }
    }
  }
  monthsCache = baseMonths;

  // Use mounted Lit component
  const comp = ensureComponentMounted(header);
  if(comp?.renderMonths){
    comp.bus = bus;
    comp.monthWidth = TIMELINE_CONFIG.monthWidth;
    comp.renderMonths(monthsCache).catch(()=>{});
    try{ bus.emit(TimelineEvents.MONTHS, monthsCache); }catch(e){}
    const totalWidth = monthsCache.length * TIMELINE_CONFIG.monthWidth;
    header.style.width = (totalWidth + 10) + 'px';
    const board = document.querySelector('feature-board');
    if(board){ board.style.width = totalWidth + 'px'; }
  } else {
    // No component available; still emit months so consumers can respond
    try{ bus.emit(TimelineEvents.MONTHS, monthsCache); }catch(e){}
  }

  // Initial scroll so current month is at left edge
  if(!didInitialScroll){
    const today = new Date();
    const idx = monthsCache.findIndex(m => m.getFullYear()===today.getFullYear() && m.getMonth()===today.getMonth());
    if(idx >= 0){
      const section = document.getElementById('timelineSection');
      if(section){ 
        requestAnimationFrame(()=>{ 
          section.scrollLeft = idx * TIMELINE_CONFIG.monthWidth; 
          didInitialScroll = true; 
        }); 
      }
    } else { 
      didInitialScroll = true; 
    }
  }
  if(shouldInstrument && typeof performance !== 'undefined' && performance.now){
    try{ 
      const t1 = performance.now(); 
      console.info('[timeline] renderTimelineHeader took', Math.round(t1 - t0), 'ms'); 
    }catch(e){}
  }
}

// Coalesced scheduler to avoid repeated heavy header work during bursts
let _headerScheduled = false;
let _headerPendingPayload = null;
function scheduleRenderTimelineHeader(payload){
  _headerPendingPayload = payload || _headerPendingPayload;
  if(_headerScheduled) return;
  _headerScheduled = true;
  const run = () => { _headerScheduled = false; const p = _headerPendingPayload; _headerPendingPayload = null; renderTimelineHeader(p); };
  if(typeof window !== 'undefined' && window.requestIdleCallback){
    try{ window.requestIdleCallback(run, {timeout: 50}); return; }catch(e){}
  }
  requestAnimationFrame(run);
}

function enableTimelinePanning(){
  const section = document.getElementById('timelineSection'); 
  if(!section) return;
  let isPanning = false;
  let startX = 0, startY = 0;
  let startScrollLeft = 0, startScrollTop = 0;
  section.addEventListener('mousedown', e => {
    if (e.target.closest('.feature-card') || e.target.classList.contains('drag-handle')) return;
    isPanning = true; 
    startX = e.clientX; 
    startY = e.clientY; 
    startScrollLeft = section.scrollLeft;
    const featureBoard = document.querySelector('feature-board');
    startScrollTop = featureBoard?.scrollTop ?? 0;
    section.classList.add('panning');
    function onMove(ev) { 
      if (!isPanning) return; 
      const dx = ev.clientX - startX; 
      const dy = ev.clientY - startY; 
      section.scrollLeft = startScrollLeft - dx; 
      if (featureBoard) featureBoard.scrollTop = startScrollTop - dy; 
    }
    function onUp() { 
      isPanning = false; 
      section.classList.remove('panning'); 
      window.removeEventListener('mousemove', onMove); 
      window.removeEventListener('mouseup', onUp); 
    }
    window.addEventListener('mousemove', onMove); 
    window.addEventListener('mouseup', onUp);
  });
}

// Export helper for tests/tools
export function _resetTimelineState(){ monthsCache = []; didInitialScroll = false; timelineElement = null; }

/**
 * Ensure the timeline is scrolled to the current month after layout stabilizes.
 * Observes DOM mutations and listens for TimelineEvents.MONTHS and FeatureEvents.UPDATED
 * to determine when months and cards have been rendered, then sets the scrollLeft
 * and marks `didInitialScroll` so subsequent renders won't override it.
 */
export function ensureScrollToMonth(date){
  // Simplified: accept only a Date (or default to today) and attempt a minimal
  // retry using the TimelineEvents.MONTHS bus event and a short timeout.
  try{
    const monthWidth = TIMELINE_CONFIG.monthWidth ?? 120;
    const targetDate = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date();

    const resolveIndex = () => {
      if(!monthsCache?.length) return -1;
      return monthsCache.findIndex(m => m.getFullYear() === targetDate.getFullYear() && m.getMonth() === targetDate.getMonth());
    };

    const tryScroll = () => {
      const idx = resolveIndex();
      if(idx === -1) return false;
      const section = document.getElementById('timelineSection');
      if(!section) return false;
      const left = idx * monthWidth;
      requestAnimationFrame(()=>{ section.scrollLeft = left; });
      return true;
    };

    if(tryScroll()){
      didInitialScroll = true;
      return;
    }

    // Listen once for months emitted, attempt scroll, and clear
    const onMonths = () => {
      if(tryScroll()){
        didInitialScroll = true;
        try{ unsub?.(); }catch(e){}
      }
    };

    const unsub = bus.on(TimelineEvents.MONTHS, onMonths);

    // Safety timeout: stop listening after 3s
    setTimeout(()=>{ try{ unsub?.(); }catch(e){} }, 3000);
  }catch(e){ console.warn('[timeline] ensureScrollToMonth failed', e); }
}
