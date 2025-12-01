import { state } from './state.js';
import { bus } from './eventBus.js';
import { parseDate, formatDate, addMonths, dateRangeInclusiveMonths } from './util.js';

// Graph/timeline rendering config (kept here to centralize cross-module use)
export const TIMELINE_CONFIG = {
  monthWidth: 120,           // must match CSS var --timeline-month-width
  teamLineWidth: 2,          // stroke width for team load lines
  teamLineOpacity: 0.9,      // default line opacity
  overloadBgAlpha: 0.18,     // background alpha for overload bands
  overloadBgColor: '#ff3b30' // fallback if team color missing
};

let monthsCache = [];
let didInitialScroll = false;

export function initTimeline(){
  bus.on('feature:updated', renderTimelineHeader);
  bus.on('timeline:scale', renderTimelineHeader);
  window.addEventListener('resize', renderTimelineHeader);
  enableTimelinePanning();
  renderTimelineHeader();
}

export function getTimelineMonths(){ return monthsCache; }

function computeRange(){
  const feats = state.getEffectiveFeatures();
  if(feats.length===0){ const today = new Date(); return { min: today, max: addMonths(today, 6) }; }
  let min = parseDate(feats[0].start); let max = parseDate(feats[0].end);
  for(const f of feats){ const s = parseDate(f.start); const e = parseDate(f.end); if(s<min) min = s; if(e>max) max = e; }
  min = addMonths(min, -1); max = addMonths(max, 2); return {min, max};
}

function renderTimelineHeader(){
  const header = document.getElementById('timelineHeader'); if(!header) return;
  const {min, max} = computeRange(); let baseMonths = dateRangeInclusiveMonths(min, max);
  // Ensure months fill the visible timeline width so header spans entire card area
  const monthWidth = TIMELINE_CONFIG.monthWidth; // matches CSS var --timeline-month-width
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
  header.innerHTML = '';
  monthsCache.forEach(m=>{ const cell = document.createElement('div'); cell.className='timeline-cell'; cell.style.width='var(--timeline-month-width)'; cell.textContent = m.toLocaleString('default',{month:'short', year:'2-digit'}); header.appendChild(cell); });
  // Expand header width to reflect full span for horizontal scrolling
  const totalWidth = monthsCache.length * TIMELINE_CONFIG.monthWidth; // sync with month width
  header.style.width = totalWidth + 'px';
  const board = document.getElementById('featureBoard'); if(board){ board.style.width = totalWidth + 'px'; }
  // Initial scroll so current month is at left edge
  if(!didInitialScroll){
    const today = new Date();
    const idx = monthsCache.findIndex(m => m.getFullYear()===today.getFullYear() && m.getMonth()===today.getMonth());
    if(idx > 0){
      const section = document.getElementById('timelineSection');
      if(section){
        // Defer until layout applied
        requestAnimationFrame(()=>{ section.scrollLeft = idx * TIMELINE_CONFIG.monthWidth; didInitialScroll = true; });
      }
    } else {
      didInitialScroll = true; // nothing to scroll or already first
    }
  }
  bus.emit('timeline:months', monthsCache);
}

function enableTimelinePanning(){
  const section = document.getElementById('timelineSection'); if(!section) return;
  let isPanning=false; let startX=0; let startScroll=0;
  section.addEventListener('mousedown', e => {
    // Ignore drags originating on feature cards / resize handles
    if(e.target.closest('.feature-card') || e.target.classList.contains('drag-handle')) return;
    isPanning=true; startX=e.clientX; startScroll=section.scrollLeft; section.classList.add('panning');
    function onMove(ev){ if(!isPanning) return; const dx = ev.clientX - startX; section.scrollLeft = startScroll - dx; }
    function onUp(){ isPanning=false; section.classList.remove('panning'); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  });
}
