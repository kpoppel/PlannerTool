// www/js/components/MainGraph.lit.js
// Lit 3.3.1 web component for main organizational load graph

import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { getTimelineMonths } from '../components/Timeline.lit.js';
import { FeatureEvents, CapacityEvents, ProjectEvents, TeamEvents, FilterEvents, TimelineEvents, ViewEvents } from '../core/EventRegistry.js';

/**
 * MainGraphLit - Lit-based main graph component with canvas rendering
 * @property {Object} bus - EventBus instance for emitting events
 * @property {number} width - Canvas width in pixels
 * @property {number} height - Canvas height in pixels
 */
export class MainGraphLit extends LitElement {
  static properties = {
    bus: { type: Object },
    width: { type: Number },
    height: { type: Number }
  };

  constructor() {
    super();
    this.bus = null;
    this.width = 800;
    this.height = 120;
    this._canvasRef = null;
    this._renderData = null;
    // constructor
    this._resizeObserver = null;
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .graph-container {
      width: 100%;
      // height: 100%;
      height: 120px;
      position: relative;
      // z-index: 5;
      background:#b0cbe6;
      border-bottom:0px solid var(--color-border);
      //padding:0;
      }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    `;

  render() {
    return html`
      <div class="graph-container">
        <canvas
          id="graphCanvas"
          width="${this.width}"
          height="${this.height}"
        ></canvas>
      </div>
    `;
  }

  firstUpdated() {
    this._canvasRef = this.shadowRoot.getElementById('graphCanvas');
    // Observe host size changes to keep canvas pixel buffer in sync
    try{
      this._resizeObserver = new ResizeObserver(() => {
        if(this._renderData){
          // Re-render on next frame
          requestAnimationFrame(()=> this.renderGraph(this._renderData));
        }
      });
      this._resizeObserver.observe(this);
    }catch(e){ /* ResizeObserver may not be available in some test envs */ }
    // Setup event-driven scheduler so component owns its rendering lifecycle
    this._maingraphScheduled = false;
    this._maingraphUnsubs = [];
    const buildSnapshot = () => {
      const months = getTimelineMonths() || [];
      return {
        months,
        teams: state.teams || [],
        projects: state.projects || [],
        capacityDates: state.capacityDates || [],
        teamDailyCapacity: state.teamDailyCapacity || [],
        teamDailyCapacityMap: state.teamDailyCapacityMap || null,
        projectDailyCapacity: state.projectDailyCapacity || [],
        projectDailyCapacityMap: state.projectDailyCapacityMap || null,
        totalOrgDailyPerTeamAvg: state.totalOrgDailyPerTeamAvg || [],
        capacityViewMode: state.capacityViewMode || 'team',
        selectedTeamIds: (state.teams || []).filter(t=>t.selected).map(t=>t.id),
        selectedProjectIds: (state.projects || []).filter(p=>p.selected).map(p=>p.id)
      };
    };

    const scheduleRender = async () => {
      if(this._maingraphScheduled) return;
      this._maingraphScheduled = true;
      requestAnimationFrame(async ()=>{
        this._maingraphScheduled = false;
        try{
          const snapshot = buildSnapshot();
          try{ if(this.updateComplete && typeof this.updateComplete.then === 'function') await this.updateComplete; }catch(e){}
          if(typeof this.renderGraph === 'function') await this.renderGraph(snapshot);
        }catch(e){ console.error('[maingraph-lit] render error', e); }
      });
    };

    // Subscribe to bus events
    this._maingraphUnsubs.push(bus.on(FeatureEvents.UPDATED, scheduleRender));
    this._maingraphUnsubs.push(bus.on(CapacityEvents.UPDATED, scheduleRender));
    this._maingraphUnsubs.push(bus.on(ProjectEvents.CHANGED, scheduleRender));
    this._maingraphUnsubs.push(bus.on(TeamEvents.CHANGED, scheduleRender));
    this._maingraphUnsubs.push(bus.on(FilterEvents.CHANGED, scheduleRender));
    this._maingraphUnsubs.push(bus.on(TimelineEvents.MONTHS, scheduleRender));
    this._maingraphUnsubs.push(bus.on(ViewEvents.CAPACITY_MODE, scheduleRender));

    // Also listen for scroll on timelineSection
    const section = document.getElementById('timelineSection');
    if(section){
      this._maingraphScrollHandler = scheduleRender;
      section.addEventListener('scroll', this._maingraphScrollHandler, { passive: true });
    }

    // Initial render
    scheduleRender();
  }

  disconnectedCallback(){
    super.disconnectedCallback && super.disconnectedCallback();
    try{ if(this._resizeObserver) this._resizeObserver.disconnect(); }catch(e){}
    // Unsubscribe from bus events
    try{
      if(this._maingraphUnsubs && Array.isArray(this._maingraphUnsubs)){
        this._maingraphUnsubs.forEach(u=>{ try{ if(typeof u === 'function') u(); }catch(e){} });
        this._maingraphUnsubs = null;
      }
    }catch(e){}
    // Remove scroll handler
    try{
      const section = document.getElementById('timelineSection');
      if(section && this._maingraphScrollHandler) section.removeEventListener('scroll', this._maingraphScrollHandler);
      this._maingraphScrollHandler = null;
    }catch(e){}
  }

  /**
   * Public API: Render graph with provided data
   * @param {Object} data - Graph data including months, teamData, projectData
   */
  async renderGraph(data) {
    if (!this._canvasRef || !data) return;

    this._renderData = data;

    // Extract commonly used data fields (fall back to empty arrays/maps)
    const months = data.months || [];
    const teams = data.teams || [];
    const projects = data.projects || [];
    const capacityDates = data.capacityDates || [];
    const teamDailyCapacity = data.teamDailyCapacity || [];
    const teamDailyCapacityMap = data.teamDailyCapacityMap || null;
    const projectDailyCapacity = data.projectDailyCapacity || [];
    const projectDailyCapacityMap = data.projectDailyCapacityMap || null;
    const totalOrgDailyPerTeamAvg = data.totalOrgDailyPerTeamAvg || [];
    const capacityViewMode = data.capacityViewMode || 'team';
    const selectedTeamIds = new Set(data.selectedTeamIds || (teams.filter(t=>t.selected).map(t=>t.id)));
    const selectedProjectIds = new Set(data.selectedProjectIds || (projects.filter(p=>p.selected).map(p=>p.id)));
    const selectedStateFilter = data.selectedStateFilter || null;

    // Get canvas context
    const ctx = this._canvasRef.getContext('2d');
    if (!ctx) return;

    // If months not provided, nothing to draw
    if (months.length === 0) {
      ctx.clearRect(0,0,this._canvasRef.width, this._canvasRef.height);
      return;
    }

    // Prefer the component's host size; fall back to timelineSection width or configured defaults
    const hostRect = this.getBoundingClientRect ? this.getBoundingClientRect() : null;
    const sectionEl = document.getElementById('timelineSection');
    const desiredWidth = (hostRect && hostRect.width) ? Math.floor(hostRect.width) : ((sectionEl && sectionEl.clientWidth) ? sectionEl.clientWidth : (this.width || 800));
    const desiredHeight = (hostRect && hostRect.height) ? Math.floor(hostRect.height) : (this.height || 120);
    // Only update canvas backing buffer when dimensions changed to avoid unnecessary redraws
    if(this._canvasRef.width !== desiredWidth || this._canvasRef.height !== desiredHeight){
      this._canvasRef.width = desiredWidth;
      this._canvasRef.height = desiredHeight;
    }

    // Clear canvas
    ctx.clearRect(0, 0, this._canvasRef.width, this._canvasRef.height);

    // Delegate to full renderer
    this._fullRender(ctx, { months, teams, projects, capacityDates, teamDailyCapacity, teamDailyCapacityMap, projectDailyCapacity, projectDailyCapacityMap, totalOrgDailyPerTeamAvg, capacityViewMode, selectedTeamIds, selectedProjectIds, selectedStateFilter });
  }

  /**
   * Internal: Render graph content to canvas
   * @private
   */
  _renderGraphContent(ctx, months, teamData, projectData) {
    // Left for compatibility with older tests - not used when full renderer is present
    const graphHeight = this._canvasRef ? this._canvasRef.height : this.height;
    const graphWidth = this._canvasRef ? this._canvasRef.width : this.width;

    // Draw background
    ctx.fillStyle = '#f7f7f7';
    ctx.fillRect(0, 0, graphWidth, graphHeight);

    // Draw baseline
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, graphHeight / 2);
    ctx.lineTo(graphWidth, graphHeight / 2);
    ctx.stroke();
  }

  _fullRender(ctx, stateSnapshot){
    // _fullRender start
    // Ported rendering logic adapted from www/js/mainGraph.js
    const { months, teams, projects, capacityDates, teamDailyCapacity, teamDailyCapacityMap, projectDailyCapacity, projectDailyCapacityMap, totalOrgDailyPerTeamAvg, capacityViewMode, selectedTeamIds, selectedProjectIds } = stateSnapshot;

    const TIMELINE_CONFIG = (window.TIMELINE_CONFIG || { monthWidth: 120, overloadBgColor: '#e74c3c', overloadBgAlpha: 0.2 });
    const MONTH_WIDTH = TIMELINE_CONFIG.monthWidth;

    function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }
    function hexToRgba(hex, alpha){
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if(!m){ return `rgba(231,76,60,${alpha})`; }
      const r = parseInt(m[1],16), g = parseInt(m[2],16), b = parseInt(m[3],16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    const msPerDay = 24*60*60*1000;
    function dateToIndex(monthsArr, date){ const start = monthsArr[0]; return Math.floor((date - start) / msPerDay); }
    // indexToDate is expensive (allocates); only use when absolutely needed. Provide a minimal version.
    function indexToDate(monthsArr, idx){ const start = monthsArr[0]; return new Date(start.getTime() + (idx * msPerDay)); }
    function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

    // Visible range: use timelineSection scroll if present, otherwise assume full months range
    const section = document.getElementById('timelineSection');
    let range = { startDate: months[0], endDate: months[months.length-1] };
    if(section){
      const scrollLeft = section.scrollLeft;
      const width = section.clientWidth;
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
      range = { startDate, endDate };
    }

    // Build date map
    const dateIndexMap = new Map((capacityDates||[]).map((ds, i) => [ds, i]));

    const visibleStartIdx = dateToIndex(months, range.startDate);
    const visibleEndIdx = dateToIndex(months, range.endDate);

    // Precompute month/day metadata and per-day pixel widths for the full timeline; we'll only populate visible range
    const monthDayCounts = new Array(months.length);
    const monthStartDayIdx = new Array(months.length);
    let dayCursor = 0;
    for(let mi=0; mi<months.length; mi++){ const m = months[mi]; const dcount = daysInMonth(m); monthDayCounts[mi] = dcount; monthStartDayIdx[mi] = dayCursor; dayCursor += dcount; }

    // Build per-day px widths and cumulative X positions for visible range only
    const dayCount = dayCursor;
    const dayX = new Array(visibleEndIdx - visibleStartIdx + 2); // include nextX
    const dayWidth = new Array(visibleEndIdx - visibleStartIdx + 1);
    let cumX = 0;
    // compute starting month index
    let mi = 0; while(mi < months.length && monthStartDayIdx[mi] + monthDayCounts[mi] <= visibleStartIdx) mi++;
    for(; mi<months.length; mi++){
      const monthStart = monthStartDayIdx[mi];
      const daysThis = monthDayCounts[mi];
      const pxPerDay = MONTH_WIDTH / daysThis;
      const dayBegin = Math.max(visibleStartIdx, monthStart);
      const dayEnd = Math.min(visibleEndIdx, monthStart + daysThis - 1);
      if(dayBegin > dayEnd) continue;
      for(let d = dayBegin; d <= dayEnd; d++){
        const localIdx = d - visibleStartIdx;
        dayX[localIdx] = cumX;
        dayWidth[localIdx] = pxPerDay;
        cumX += pxPerDay;
      }
    }
    // nextX for visibleEnd+1
    dayX[visibleEndIdx - visibleStartIdx + 1] = cumX;

    // Build maps keyed by timeline dayIdx for the visible range
    const teamDayMap = new Map();
    const projectDayMap = new Map();
    const orgTotalsTeam = new Map();
    const orgTotalsProject = new Map();
    const nTeams = teams.length || 1;

    // Early exit if selection excludes all
    if ((teams && teams.length > 0 && selectedTeamIds && selectedTeamIds.size === 0) ||
        (projects && projects.length > 0 && selectedProjectIds && selectedProjectIds.size === 0)){
      return;
    }

    for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
      const localIdx = d - visibleStartIdx;
      const idx = (()=>{
        // build iso YYYY-MM-DD from months/monthStart/day offset without constructing Date when possible
        // fallback to Date for correctness
        try{
          const ms = months[0].getTime() + (d * msPerDay);
          const iso = new Date(ms).toISOString().slice(0,10);
          return dateIndexMap.get(iso);
        }catch(e){ const iso = indexToDate(months,d).toISOString().slice(0,10); return dateIndexMap.get(iso); }
      })();
      if(idx === undefined){
        teamDayMap.set(d, {});
        projectDayMap.set(d, {});
        orgTotalsTeam.set(d, 0);
        orgTotalsProject.set(d, 0);
        continue;
      }
      const teamBucket = {};
      let maxTeamVal = 0;
      const dayTeamMap = (teamDailyCapacityMap && teamDailyCapacityMap[idx]) || null;
      if(dayTeamMap){
        for(const team of teams){
          const v = dayTeamMap[team.id] || 0;
          teamBucket[team.id] = selectedTeamIds.has(team.id) ? v : 0;
          if(selectedTeamIds.has(team.id) && v > maxTeamVal) maxTeamVal = v;
        }
      } else {
        const tTuple = teamDailyCapacity[idx] || [];
        for(let i=0;i<teams.length;i++){
          const team = teams[i];
          const v = (tTuple[i] || 0);
          teamBucket[team.id] = selectedTeamIds.has(team.id) ? v : 0;
          if(selectedTeamIds.has(team.id) && v > maxTeamVal) maxTeamVal = v;
        }
      }
      teamDayMap.set(d, teamBucket);

      // Project bucket
      const projectBucket = {};
      const dayProjectMap = (projectDailyCapacityMap && projectDailyCapacityMap[idx]) || null;
      if(dayProjectMap){
        for(const project of projects){
          const v = dayProjectMap[project.id] || 0;
          projectBucket[project.id] = selectedProjectIds.has(project.id) ? (v / Math.max(1, nTeams)) : 0;
        }
      } else {
        const pTuple = projectDailyCapacity[idx] || [];
        for(let i=0;i<projects.length;i++){
          const project = projects[i];
          projectBucket[project.id] = selectedProjectIds.has(project.id) ? (pTuple[i] || 0) : 0;
        }
      }
      projectDayMap.set(d, projectBucket);

      orgTotalsTeam.set(d, maxTeamVal);
      let totalPerTeam = 0;
      if(dayProjectMap){
        for(const pid of Object.keys(dayProjectMap)){
          if(!selectedProjectIds.has(pid)) continue;
          totalPerTeam += (dayProjectMap[pid] || 0) / Math.max(1, nTeams);
        }
      } else {
        for(let i=0;i<projects.length;i++){
          const proj = projects[i];
          if(!selectedProjectIds.has(proj.id)) continue;
          totalPerTeam += (projectDailyCapacity[idx] && projectDailyCapacity[idx][i]) ? projectDailyCapacity[idx][i] / Math.max(1, nTeams) : 0;
        }
      }
      orgTotalsProject.set(d, totalPerTeam);
    }

    function pxPerDay(date){ return MONTH_WIDTH / daysInMonth(date); }
    function xForDayIndex(dayIdx){
      let cum = 0;
      const startDate = new Date(range.startDate);
      let curIdx = dateToIndex(months, startDate);
      let curDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      while(curIdx < dayIdx){ cum += pxPerDay(curDate); curDate.setDate(curDate.getDate()+1); curIdx++; }
      return Math.floor(cum);
    }

    const usingTeam = capacityViewMode === 'team';
    const chosenMap = usingTeam ? teamDayMap : projectDayMap;
    const chosenTotals = usingTeam ? orgTotalsTeam : orgTotalsProject;

    // compute maxTotal
    let maxTotal = 0;
    if(usingTeam){
      for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
        const bucket = teamDayMap.get(d) || {};
        for(const team of teams){ const v = bucket[team.id] || 0; if(v > maxTotal) maxTotal = v; }
      }
    } else {
      for(let d = visibleStartIdx; d <= visibleEndIdx; d++){ const total = chosenTotals.get(d) || 0; if(total > maxTotal) maxTotal = total; }
    }
    const maxYPercent = Math.max(100, Math.ceil(maxTotal * 1.1));
    const bottomBand = 8;
    const drawHeight = this._canvasRef.height - bottomBand;
    const percentToPx = drawHeight / maxYPercent;

    // overload bands
    let inSpan = false; let spanStartX = 0;
    for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
      const total = chosenTotals.get(d) || 0;
      const localIdx = d - visibleStartIdx;
      const x = Math.floor(dayX[localIdx]);
      const nextX = Math.floor(dayX[localIdx + 1]);
      const over = total > 100;
      if(over && !inSpan){ inSpan = true; spanStartX = x; }
      if(!over && inSpan){ ctx.fillStyle = `${hexToRgba(TIMELINE_CONFIG.overloadBgColor, TIMELINE_CONFIG.overloadBgAlpha)}`; ctx.fillRect(spanStartX, 0, x - spanStartX, this._canvasRef.height); inSpan = false; }
      if(d === visibleEndIdx && inSpan){ ctx.fillStyle = `${hexToRgba(TIMELINE_CONFIG.overloadBgColor, TIMELINE_CONFIG.overloadBgAlpha)}`; ctx.fillRect(spanStartX, 0, nextX - spanStartX, this._canvasRef.height); inSpan = false; }
    }

    // dayX array already precomputed (indexed by localIdx = day - visibleStartIdx)

    // Draw content
    if(usingTeam){
      const teamPoints = teams.map(()=>[]);
      const daySegments = [];
      for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
        const localIdx = d - visibleStartIdx;
        const x = Math.floor(dayX[localIdx]);
        const nextX = Math.floor(dayX[localIdx + 1]);
        const bucket = chosenMap.get(d) || {};
        const total = chosenTotals.get(d) || 0;
        daySegments.push({ dayIdx: d, startX: x, endX: nextX, total });
          for(let ti=0; ti<teams.length; ti++){ const teamId = teams[ti].id; const val = bucket[teamId] || 0; const y = drawHeight - (val * percentToPx); teamPoints[ti].push({ x, y, val, dayIdx: d }); }
      }
      // subtle grid
      ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.04)'; ctx.lineWidth = 1; for(const entry of daySegments){ const x = entry.startX; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x, drawHeight); ctx.stroke(); } ctx.restore();
      for(let ti=0; ti<teams.length; ti++){ const team = teams[ti]; const pts = teamPoints[ti]; if(!pts.length) continue; ctx.beginPath(); for(let i=0;i<pts.length;i++){ const p = pts[i]; if(i===0) ctx.moveTo(p.x + 0.5, p.y); else ctx.lineTo(p.x + 0.5, p.y); } ctx.strokeStyle = team.color || '#888'; ctx.lineWidth = 2; ctx.stroke(); }
    } else {
      for(let d = visibleStartIdx; d <= visibleEndIdx; d++){
        const bucket = chosenMap.get(d) || {};
        let y = drawHeight;
        const localIdx = d - visibleStartIdx;
        const x = Math.floor(dayX[localIdx]);
        const nextX = Math.floor(dayX[localIdx + 1]);
        const dayWidth = Math.max(1, nextX - x);
        for(const project of projects){ const val = bucket[project.id] || 0; if(val <= 0) continue; const h = clamp(Math.round(val * percentToPx), 0, this._canvasRef.height); ctx.fillStyle = project.color || '#888'; ctx.fillRect(x, y - h, dayWidth, h); y -= h; }
      }
    }

    // 100% dotted line
    ctx.save(); ctx.beginPath(); ctx.setLineDash([5,5]); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; const y100 = drawHeight - Math.round(100 * percentToPx); ctx.moveTo(0, y100); ctx.lineTo(this._canvasRef.width, y100); ctx.stroke(); ctx.restore();
  }

  /**
   * Public API: Update viewport/scroll position
   * @param {Object} viewport - Viewport info with scrollLeft, scrollTop
   */
  updateViewport(viewport) {
    // Re-render with current data if viewport changes
    if (this._renderData) {
      this.renderGraph(this._renderData);
    }
  }

  /**
   * Get the canvas element
   * @returns {HTMLCanvasElement} Canvas element
   */
  getCanvas() {
    return this._canvasRef;
  }
}

// Register the custom element
customElements.define('maingraph-lit', MainGraphLit);
