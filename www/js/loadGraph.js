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
  // Use precomputed daily capacity arrays from state for faster rendering and
  // to ensure graphs reflect the active scenario and normalization rules.
  const nTeams = state.teams.length || 1;
  const dates = state.capacityDates || [];
  const teamDaily = state.teamDailyCapacity || [];
  const projectDaily = state.projectDailyCapacity || []; // normalized per-project
  const totalOrgPerTeam = state.totalOrgDailyPerTeamAvg || [];
  // Build a date->index map for quick lookup (dates are ISO yyyy-mm-dd)
  const dateIndexMap = new Map(dates.map((ds, i) => [ds, i]));

  // Determine visible day index range for mapping dates to timeline positions
  const visibleStartIdx = dateToIndex(months, range.startDate);
  const visibleEndIdx = dateToIndex(months, range.endDate);
  const msPerDay = 24*60*60*1000;

  // Build maps keyed by timeline dayIdx for the visible range
  // Respect current selection flags on teams/projects: only include selected items
  const teamDayMap = new Map();
  const projectDayMap = new Map();
  const orgTotalsTeam = new Map();
  const orgTotalsProject = new Map();
  const selectedTeamIds = new Set((state.teams || []).filter(t=>t.selected).map(t=>t.id));
  const selectedProjectIds = new Set((state.projects || []).filter(p=>p.selected).map(p=>p.id));
  for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
    const date = indexToDate(months, d);
    const iso = date.toISOString().slice(0,10);
    const idx = dateIndexMap.get(iso);
    if(idx === undefined){
      // no data for this date
      teamDayMap.set(d, {});
      projectDayMap.set(d, {});
      orgTotalsTeam.set(d, 0);
      orgTotalsProject.set(d, 0);
      continue;
    }
    // Team bucket: use raw team values (percent per team), include only selected teams
    const tTuple = teamDaily[idx] || [];
    const teamBucket = {};
    let maxTeamVal = 0;
    for(let i=0;i<state.teams.length;i++){
      const team = state.teams[i];
      const v = (tTuple[i] || 0);
      // respect selection: if the team is not selected, treat its value as 0
      teamBucket[team.id] = selectedTeamIds.has(team.id) ? v : 0;
      if(selectedTeamIds.has(team.id) && v > maxTeamVal) maxTeamVal = v;
    }
    teamDayMap.set(d, teamBucket);
    // Project bucket: already normalized in state.projectDailyCapacity
    const pTuple = projectDaily[idx] || [];
    const projectBucket = {};
    for(let i=0;i<state.projects.length;i++){
      const project = state.projects[i];
      // respect selection: if the project is not selected, value is 0
      projectBucket[project.id] = selectedProjectIds.has(project.id) ? (pTuple[i] || 0) : 0;
    }
    projectDayMap.set(d, projectBucket);
    // Totals
    // For team view we set the day's total to the maximum team load so overload highlights when any team is >100%.
    orgTotalsTeam.set(d, maxTeamVal);
    // For project view compute total only from selected projects (per-team average values)
    let totalPerTeam = 0;
    for(let i=0;i<state.projects.length;i++){
      const proj = state.projects[i];
      if(!selectedProjectIds.has(proj.id)) continue;
      totalPerTeam += (projectDaily[idx] && projectDaily[idx][i]) ? projectDaily[idx][i] / Math.max(1, nTeams) : 0;
    }
    orgTotalsProject.set(d, totalPerTeam);
  }
  

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
  if(usingTeam){
    // compute max across all teams in the visible range
    for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
      const bucket = teamDayMap.get(d) || {};
      for(const team of state.teams){
        const v = bucket[team.id] || 0;
        if(v > maxTotal) maxTotal = v;
      }
    }
  } else {
    for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
      const total = chosenTotals.get(d) || 0;
      if(total > maxTotal) maxTotal = total;
    }
  }
  // Minimum scaling at 100% to keep the 100% line visible; add small headroom above observed max.
  const maxYPercent = Math.max(100, Math.ceil(maxTotal * 1.1));
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
  // Precompute x positions for each visible day to reuse for line plotting
  const dayX = new Map();
  for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
    dayX.set(d, xForDayIndex(d));
  }

  // If using team view, draw a line per team. Otherwise fall back to stacked bars per project.
  if(usingTeam){
    // Build per-team arrays of values (normalized per-team) and also populate daySegmentsCache for hover/interaction
    const teamPoints = state.teams.map(() => []); // array of [ { x, y, val, date, dayIdx } ]
    for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
      const x = dayX.get(d);
      const nextX = xForDayIndex(d+1);
      const bucket = chosenMap.get(d) || {};
      const total = chosenTotals.get(d) || 0;
      // Store day segments cache entry (for tests/hover info)
      daySegmentsCache.push({ dayIdx: d, startX: x, endX: nextX, total, date: indexToDate(months,d) });
      // For each team construct the point
      for(let ti=0; ti<state.teams.length; ti++){
        const teamId = state.teams[ti].id;
        const val = bucket[teamId] || 0; // normalized percent (0..100)
        const y = drawHeight - (val * percentToPx);
        teamPoints[ti].push({ x, y, val, date: indexToDate(months,d), dayIdx: d });
      }
    }

    // Draw grid-like background for readability (optional subtle lines)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 1;
    for(const entry of daySegmentsCache){
      const x = entry.startX;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x, drawHeight); ctx.stroke();
    }
    ctx.restore();

    // Draw a polyline for each team
    for(let ti=0; ti<state.teams.length; ti++){
      const team = state.teams[ti];
      const pts = teamPoints[ti];
      if(!pts.length) continue;
      ctx.beginPath();
      for(let i=0;i<pts.length;i++){
        const p = pts[i];
        if(i===0) ctx.moveTo(p.x + 0.5, p.y);
        else ctx.lineTo(p.x + 0.5, p.y);
      }
      ctx.strokeStyle = team.color || '#888';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw small markers at points
      //ctx.fillStyle = team.color || '#888';
      //for(const p of pts){
      //  ctx.beginPath(); ctx.arc(p.x + 0.5, p.y, 2, 0, Math.PI*2); ctx.fill();
      //}
    }
  } else {
    for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
      const bucket = chosenMap.get(d) || {};
      let y = drawHeight;
      const x = dayX.get(d);
      const nextX = xForDayIndex(d+1);
      const dayWidth = Math.max(1, nextX - x);
      for(const project of state.projects){
        const val = bucket[project.id] || 0;
        if(val <= 0) continue;
        const h = clamp(Math.round(val * percentToPx), 0, canvas.height);
        ctx.fillStyle = project.color || '#888';
        ctx.fillRect(x, y - h, dayWidth, h);
        y -= h;
      }
      daySegmentsCache.push({ dayIdx: d, startX: x, endX: nextX, total: chosenTotals.get(d) || 0, date: indexToDate(months,d) });
    }
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
