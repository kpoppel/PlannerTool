import { state } from './state.js';
import { bus } from './eventBus.js';
import { getTimelineMonths, TIMELINE_CONFIG } from './timeline.js';
import { computeDailyLoadMaps } from './loadMath.js';

// Constants sourced from centralized timeline config
const MONTH_WIDTH = TIMELINE_CONFIG.monthWidth; // keep in sync with CSS var --timeline-month-width

function getTimelineSection(){ return document.getElementById('timelineSection'); }
function getCanvas(){ return document.getElementById('loadGraphCanvas'); }

function dateToIndex(months, date){
  // Map a Date to a continuous day index from the first month start
  const start = months[0];
  const msPerDay = 24*60*60*1000;
  return Math.floor((date - start) / msPerDay);
}
function indexToDate(months, idx){
  const start = months[0];
  const msPerDay = 24*60*60*1000;
  return new Date(start.getTime() + (idx * msPerDay));
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }
function hexToRgba(hex, alpha){
  // Accepts formats like #rrggbb
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if(!m){ return `rgba(231,76,60,${alpha})`; }
  const r = parseInt(m[1],16), g = parseInt(m[2],16), b = parseInt(m[3],16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getVisibleRange(months){
  const section = getTimelineSection();
  if(!section || !months || months.length===0){
    return { startDate: months?.[0] || new Date(), endDate: months?.[months.length-1] || new Date() };
  }
  const scrollLeft = section.scrollLeft;
  const width = section.clientWidth;
  // Convert scrollLeft in pixels to month/day
  const startMonthIdx = Math.floor(scrollLeft / MONTH_WIDTH);
  const startMonthOffsetPx = scrollLeft - (startMonthIdx * MONTH_WIDTH);
  const startMonthDate = months[clamp(startMonthIdx,0,months.length-1)];
  const startMonthDays = daysInMonth(startMonthDate);
  const startDay = Math.floor((startMonthOffsetPx / MONTH_WIDTH) * startMonthDays);
  const startDate = new Date(startMonthDate.getFullYear(), startMonthDate.getMonth(), 1 + startDay);

  const endPx = scrollLeft + width;
  const endMonthIdx = Math.floor(endPx / MONTH_WIDTH);
  const endMonthOffsetPx = endPx - (endMonthIdx * MONTH_WIDTH);
  const endMonthDate = months[clamp(endMonthIdx,0,months.length-1)];
  const endMonthDays = daysInMonth(endMonthDate);
  const endDay = Math.floor((endMonthOffsetPx / MONTH_WIDTH) * endMonthDays);
  const endDate = new Date(endMonthDate.getFullYear(), endMonthDate.getMonth(), 1 + endDay);

  return { startDate, endDate };
}


let hoverState = { timer:null, lastDay:null, data:null };
let daySegmentsCache = []; // [{dayIdx,startX,endX,segments:[{id,label,color,value}], total}]
let lastRange = null;


function render(){
  const canvas = getCanvas(); if(!canvas) return;
  const months = getTimelineMonths(); if(!months || months.length===0) return;
  const range = getVisibleRange(months);
  // Resize canvas to viewport width
  const section = getTimelineSection();
  canvas.width = section ? section.clientWidth : 800;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const effective = state.getEffectiveFeatures();
  const { teamDayMap, projectDayMap, orgTotalsTeam, orgTotalsProject } = computeDailyLoadMaps(effective, state.teams, state.projects, { showEpics: state.showEpics, showFeatures: state.showFeatures }, range);
  const visibleStartIdx = dateToIndex(months, range.startDate);
  const visibleEndIdx = dateToIndex(months, range.endDate);
  const msPerDay = 24*60*60*1000;

  // Helper: per-day pixel width depends on month
  function pxPerDay(date){ return MONTH_WIDTH / daysInMonth(date); }
  function xForDayIndex(dayIdx){
    // Walk days from visible start to target and sum per-day widths
    // Use floor on cumulative to avoid pixel gaps between days.
    let cum = 0;
    const startDate = new Date(range.startDate);
    let curIdx = dateToIndex(months, startDate);
    let curDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    while(curIdx < dayIdx){
      cum += pxPerDay(curDate);
      // advance a day
      curDate.setDate(curDate.getDate()+1);
      curIdx++;
    }
    return Math.floor(cum);
  }

  // Prepare chosen day map & totals based on view mode
  const usingTeam = state.loadViewMode === 'team';
  const chosenMap = usingTeam ? teamDayMap : projectDayMap;
  const chosenTotals = usingTeam ? orgTotalsTeam : orgTotalsProject;

  // Adaptive scaling: compute max normalised organisational load in the visible range
  let maxTotal = 0;
  for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
    const total = chosenTotals.get(d) || 0;
    if(total > maxTotal) maxTotal = total;
  }
  // Minimum scaling at 100% to keep the 100% line visible; cap headroom to avoid extreme scaling.
  const maxYPercent = Math.max(100, Math.min(Math.ceil(maxTotal * 1.1), 200));
  const bottomBand = 8; // reserved band for over-capacity indicator
  const drawHeight = canvas.height - bottomBand;
  const percentToPx = drawHeight / maxYPercent;

  // Render overload background first: full-height bands for days over 100%
  const bandHeight = bottomBand;
  let inSpan = false;
  let spanStartX = 0;
  for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
    const total = chosenTotals.get(d) || 0;
    const x = xForDayIndex(d);
    const nextX = xForDayIndex(d+1);
    const over = total > 100;
    if(over && !inSpan){ inSpan = true; spanStartX = x; }
    if(!over && inSpan){
      // close current span
      ctx.fillStyle = `${hexToRgba(TIMELINE_CONFIG.overloadBgColor, TIMELINE_CONFIG.overloadBgAlpha)}`;
      ctx.fillRect(spanStartX, 0, x - spanStartX, canvas.height);
      inSpan = false;
    }
    // handle end at last day
    if(d === visibleEndIdx && inSpan){
      ctx.fillStyle = `${hexToRgba(TIMELINE_CONFIG.overloadBgColor, TIMELINE_CONFIG.overloadBgAlpha)}`;
      ctx.fillRect(spanStartX, 0, nextX - spanStartX, canvas.height);
      inSpan = false;
    }
  }

  // Draw stacked bars per day
  daySegmentsCache = [];
  for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
    const bucket = chosenMap.get(d) || {};
    let y = drawHeight;
    const x = xForDayIndex(d);
    const nextX = xForDayIndex(d+1);
    const dayWidth = Math.max(1, nextX - x);
    if(usingTeam){
      // Render in backend order using state.teams sequence
      for(const team of state.teams){
        const val = bucket[team.id] || 0;
        if(val <= 0) continue;
        const h = clamp(Math.round(val * percentToPx), 0, canvas.height);
        ctx.fillStyle = team.color || '#888';
        ctx.fillRect(x, y - h, dayWidth, h);
        y -= h;
      }
    } else {
      for(const project of state.projects){
        const val = bucket[project.id] || 0;
        if(val <= 0) continue;
        const h = clamp(Math.round(val * percentToPx), 0, canvas.height);
        ctx.fillStyle = project.color || '#888';
        ctx.fillRect(x, y - h, dayWidth, h);
        y -= h;
      }
    }
    daySegmentsCache.push({ dayIdx: d, startX: x, endX: nextX, total: chosenTotals.get(d) || 0, date: indexToDate(months,d) });
  }

  // Draw dotted 100% line across the canvas
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  const y100 = drawHeight - Math.round(100 * percentToPx);
  ctx.moveTo(0, y100);
  ctx.lineTo(canvas.width, y100);
  ctx.stroke();
  ctx.restore();

  // // Highlight timespans with total load over 100% as red bands at the bottom
  // const bandHeight = bottomBand;
  // let inSpan = false;
  // let spanStartX = 0;
  // for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
  //   const total = chosenTotals.get(d) || 0;
  //   const x = xForDayIndex(d);
  //   const nextX = xForDayIndex(d+1);
  //   const over = total > 100;
  //   if(over && !inSpan){ inSpan = true; spanStartX = x; }
  //   if(!over && inSpan){
  //     // close current span
  //     ctx.fillStyle = 'rgba(231, 76, 60, 0.8)'; // red
  //     ctx.fillRect(spanStartX, canvas.height - bandHeight, x - spanStartX, bandHeight);
  //     inSpan = false;
  //   }
  //   // handle end at last day
  //   if(d === visibleEndIdx && inSpan){
  //     ctx.fillStyle = 'rgba(231, 76, 60, 0.8)';
  //     ctx.fillRect(spanStartX, canvas.height - bandHeight, nextX - spanStartX, bandHeight);
  //     inSpan = false;
  //   }
  // }
}

export function initLoadGraph(){
  // Initial render after app ready
  let scheduled = false;
  function scheduleRender(){ if(!scheduled){ scheduled = true; requestAnimationFrame(()=>{ scheduled = false; render(); }); } }
  scheduleRender();
  // Re-render on data and viewport changes (throttled)
  bus.on('feature:updated', scheduleRender);
  bus.on('projects:changed', scheduleRender);
  bus.on('teams:changed', scheduleRender);
  bus.on('filters:changed', scheduleRender);
  bus.on('timeline:months', scheduleRender);
  bus.on('view:loadMode', scheduleRender);
  const section = getTimelineSection();
  if(section){ section.addEventListener('scroll', scheduleRender, { passive: true }); }
  const canvas = getCanvas();
}

// Expose helper for tests
export function _getDaySegmentsCache(){ return daySegmentsCache; }
