/**
 * PluginGraph component
 * Single-responsibility: render an interactive SVG 'mountain view' showing
 * capacity across days. This component reads global `state` to compute
 * per-day totals and renders either project stacked bars or team lines.
 *
 * Notes on intent:
 * - The component prefers simple, performant DOM updates using native SVG
 *   primitives rather than complex chart libraries to keep bundle size low.
 * - Date math uniformly uses UTC-localized days to avoid timezone surprises.
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { getTimelineMonths, TIMELINE_CONFIG } from '../components/Timeline.lit.js';
import { ProjectEvents, TeamEvents, StateFilterEvents, FilterEvents, CapacityEvents, ViewEvents, AppEvents } from '../core/EventRegistry.js';

export class PluginGraph extends LitElement {
  static properties = {
    visible: { type: Boolean },
    mode: { type: String }
  };

  constructor(){
    super();
    this.visible = false;
    this.mode = 'project';
    this._savedMainStyles = null;
    this._scheduledRenderTimer = null;
    this.svgEl = null;
    this.tooltipEl = null;
    this.startDate = null;
    this.endDate = null;
    this.dayOffsets = null;
    this.lastRenderedData = null;
    this.xScale = 1;
  }

  /**
   * Compute inclusive day count between two dates (UTC day boundaries).
   * @param {Date} d0
   * @param {Date} d1
   * @returns {number}
   */
  _daysBetween(d0, d1){ const ms = new Date(d1).setHours(0,0,0,0) - new Date(d0).setHours(0,0,0,0); return Math.max(0, Math.floor(ms / (24*3600*1000)) + 1); }

  static styles = css`
    :host { display: block; position: absolute; left:0; top:0; right:0; bottom:0; z-index:50; box-sizing: border-box; }
    .container { width:100%; height:100%; display:flex; flex-direction:column; padding:0 8px; box-sizing:border-box; }
    .field-row { display:flex; gap:12px; align-items:center; padding:8px 12px; }
    #mountainViewHost { width:100%; flex:1 1 auto; min-height:0; position:relative; background:transparent; }
    h3 { margin:8px 0; }
  `;

  render(){
    return html`
      <div class="container" role="dialog" aria-modal="true">
        <h3>Mountain View (SVG)</h3>
        <div class="field-row modal-field">
          <div style="display:flex; gap:8px; align-items:center; width:100%;">
            <div style="display:flex; gap:8px; align-items:center; white-space:nowrap;">
              <span style="font-weight:600; margin-top:8px;">Date Range</span>
              <input id="mvStart" type="date" style="width:150px; min-width:120px;" />
              <span> - </span>
              <input id="mvEnd" type="date" style="width:150px; min-width:120px;" />
              <button id="mvApply" type="button">Apply</button>
            </div>
            <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
              <button id="mvExportSvg" type="button">Export SVG</button>
              <button id="mvExportPng" type="button">Export PNG</button>
            </div>
          </div>
        </div>
        <div id="mountainViewHost"></div>
      </div>
    `;
  }

  firstUpdated(){
    this._ensureTooltip();
    const startInp = this.renderRoot.querySelector('#mvStart');
    const endInp = this.renderRoot.querySelector('#mvEnd');
    const applyBtn = this.renderRoot.querySelector('#mvApply');
    const exportSvgBtn = this.renderRoot.querySelector('#mvExportSvg');
    const exportPngBtn = this.renderRoot.querySelector('#mvExportPng');
    if(applyBtn) applyBtn.addEventListener('click', ()=>{ this.startDate = new Date(startInp.value); this.endDate = new Date(endInp.value); this._render(); });
    if(exportSvgBtn) exportSvgBtn.addEventListener('click', ()=>this.exportSvg());
    if(exportPngBtn) exportPngBtn.addEventListener('click', ()=>this.exportPng());

    bus.on(ProjectEvents.CHANGED, ()=> this._scheduleRender());
    bus.on(TeamEvents.CHANGED, ()=> this._scheduleRender());
    bus.on(StateFilterEvents.CHANGED, ()=> this._scheduleRender());
    bus.on(ViewEvents.CAPACITY_MODE, (mode)=>{ this.mode = mode; this._scheduleRender(); });
    bus.on(FilterEvents.CHANGED, ()=> this._scheduleRender());
    bus.on(CapacityEvents.UPDATED, ()=> this._scheduleRender());
    // Re-render once app/state is ready
    bus.on(AppEvents.READY, ()=> { this._initDateRangeDefaults(); this._scheduleRender(20); });
    if(typeof state._viewService.capacityViewMode !== 'undefined') this.mode = state._viewService.capacityViewMode;
    this._initDateRangeDefaults();
  }

  _initDateRangeDefaults(){
    const needCompute = !(this.startDate && this.endDate);
    if(needCompute){
      const months = typeof getTimelineMonths === 'function' ? getTimelineMonths() : null;
      if(months && months.length){
        const d0 = months[0];
        const last = months[months.length-1];
        const d1 = new Date(last.getFullYear(), last.getMonth()+1, 0);
        this.startDate = new Date(d0);
        this.endDate = new Date(d1);
      } else if(Array.isArray(state?.capacityDates) && state.capacityDates.length){
        const firstIso = state.capacityDates[0];
        const lastIso = state.capacityDates[state.capacityDates.length-1];
        this.startDate = new Date(firstIso);
        this.endDate = new Date(lastIso);
      } else {
        const now = new Date();
        this.startDate = new Date(now);
        this.endDate = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      }
    }
    const setInputs = ()=>{
      const startInp = this.renderRoot.querySelector('#mvStart');
      const endInp = this.renderRoot.querySelector('#mvEnd');
      if(startInp) startInp.value = this._fmtDate(this.startDate);
      if(endInp) endInp.value = this._fmtDate(this.endDate);
      return !!(startInp || endInp);
    };
    const ok = setInputs();
    if(!ok) requestAnimationFrame(()=> setInputs());
  }

  _ensureTooltip(){
    if(!this.tooltipEl){ this.tooltipEl = document.createElement('div'); document.body.appendChild(this.tooltipEl); }
    const t = this.tooltipEl;
    t.style.zIndex = '10000'; t.style.position = 'absolute'; t.style.pointerEvents = 'none'; t.style.background = 'rgba(0,0,0,0.75)'; t.style.color = '#fff'; t.style.padding = '8px 10px'; t.style.borderRadius = '6px'; t.style.fontSize = '12px'; t.style.display = 'none'; t.style.whiteSpace='normal'; t.style.wordBreak='break-word'; t.style.maxWidth='360px'; t.style.boxShadow='0 6px 18px rgba(0,0,0,0.6)'; t.style.lineHeight='1.25';
  }

  _ensureSvg(){
    const host = this.renderRoot.getElementById('mountainViewHost');
    if(!host) return null;
    if(!this.svgEl){
      this.svgEl = document.createElementNS('http://www.w3.org/2000/svg','svg');
      this.svgEl.setAttribute('preserveAspectRatio','none');
      this.svgEl.style.width='100%'; this.svgEl.style.height='100%';
      host.appendChild(this.svgEl);
      this.svgEl.addEventListener('pointermove', (e)=>{
        if(!this.dayOffsets) return;
        const r = host.getBoundingClientRect();
        const x = e.clientX - r.left;
        const unscaledX = x / (this.xScale || 1);
        let lo = 0, hi = this.dayOffsets.length-1;
        while(lo < hi){ const mid = Math.floor((lo+hi)/2); if(this.dayOffsets[mid] <= unscaledX) lo = mid+1; else hi = mid; }
        const dayIdx = Math.max(0, lo-1);
        if(dayIdx >=0 && dayIdx < this.dayOffsets.length-1){ this._showTooltip(dayIdx, (this.lastRenderedData && this.lastRenderedData.totals) ? this.lastRenderedData.totals[dayIdx] : null); this._moveTooltip(e); }
      });
      this.svgEl.addEventListener('pointerleave', ()=> this._hideTooltip());
    }
    return host;
  }

  _scheduleRender(delay = 80){
    if(this.style.display === 'none') return;
    if(this._scheduledRenderTimer) clearTimeout(this._scheduledRenderTimer);
    this._scheduledRenderTimer = setTimeout(() => {
      this._scheduledRenderTimer = null;
      try { this._render(); } catch (e) { console.error('[plugin-graph] scheduled render error', e); }
    }, delay);
  }

  open(mode){
    // prefer provided mode, fall back to state setting, then default
    if(mode) this.mode = mode;
    else if(state && typeof state._viewService.capacityViewMode !== 'undefined') this.mode = state._viewService.capacityViewMode;
    else this.mode = 'project';
    const main = document.querySelector('main');
    if(main && !this._savedMainStyles){ this._savedMainStyles = []; Array.from(main.children).forEach(child=>{ if(child === this) return; this._savedMainStyles.push({ el: child, display: child.style.display || '' }); child.style.display = 'none'; }); }
    const months = getTimelineMonths();
    let d0, d1;
    if(months && months.length){ d0 = months[0]; const last = months[months.length-1]; d1 = new Date(last.getFullYear(), last.getMonth()+1, 0); }
    else { d0 = new Date(); d1 = new Date(Date.now() + 30*24*3600*1000); }
    this.startDate = new Date(d0); this.endDate = new Date(d1);
    this._initDateRangeDefaults();
    const startInp = this.renderRoot.querySelector('#mvStart');
    const endInp = this.renderRoot.querySelector('#mvEnd');
    if(startInp) startInp.value = this._fmtDate(this.startDate);
    if(endInp) endInp.value = this._fmtDate(this.endDate);
    this.style.display = 'block';
    // schedule render (will no-op until data available); ensure quick render after DOM updates
    this._scheduleRender(20);
  }

  close(){ this.style.display = 'none'; const main = document.querySelector('main'); if(main && this._savedMainStyles){ this._savedMainStyles.forEach(s=>{ s.el.style.display = s.display; }); this._savedMainStyles = null; } }

  exportSvg(){ if(!this.svgEl) return; const serializer = new XMLSerializer(); const svgStr = serializer.serializeToString(this.svgEl); const blob = new Blob([svgStr], { type:'image/svg+xml' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'mountain-view.svg'; a.click(); URL.revokeObjectURL(url); }

  exportPng(){ if(!this.svgEl) return; const serializer = new XMLSerializer(); const svgStr = serializer.serializeToString(this.svgEl); const img = new Image(); const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr); img.onload = () => { const host = this.renderRoot.getElementById('mountainViewHost'); const vb = this.svgEl.viewBox && this.svgEl.viewBox.baseVal ? this.svgEl.viewBox.baseVal : null; const w = vb ? vb.width : host.clientWidth; const h = vb ? vb.height : host.clientHeight; const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h); canvas.toBlob((blob)=>{ const dl = document.createElement('a'); const u = URL.createObjectURL(blob); dl.href = u; dl.download = 'mountain-view.png'; dl.click(); URL.revokeObjectURL(u); }, 'image/png'); }; img.src = url; }

  _daysBetween(d0, d1){ const ms = new Date(d1).setHours(0,0,0,0) - new Date(d0).setHours(0,0,0,0); return Math.max(0, Math.floor(ms / (24*3600*1000)) + 1); }
  _addDays(d,n){ const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt; }
  _fmtDate(d){ const dd = new Date(d); return dd.toISOString().slice(0,10); }

  _computeDailyTotals(mode, sDate, eDate){
    const effective = state.getEffectiveFeatures();
    const teams = state.teams || [];
    const projects = state.projects || [];
    const showEpics = !!state._viewService.showEpics;
    const showFeatures = !!state._viewService.showFeatures;
    const selectedTeams = teams.filter(t=>t.selected).map(t=>t.id);
    const selectedProjects = projects.filter(p=>p.selected).map(p=>p.id);
    const selectedStates = (state.selectedFeatureStateFilter instanceof Set) ? Array.from(state.selectedFeatureStateFilter) : (state.selectedFeatureStateFilter ? [state.selectedFeatureStateFilter] : []);
    const projectSetSelected = new Set(selectedProjects);
    const teamSetSelected = new Set(selectedTeams);
    const stateSetSelected = new Set(selectedStates);
    if(mode === 'project' && projectSetSelected.size === 0) return { days: 0, totals: [] };
    if(mode === 'team' && teamSetSelected.size === 0) return { days: 0, totals: [] };
    if(stateSetSelected.size === 0) return { days: 0, totals: [] };

    const days = this._daysBetween(sDate, eDate);
    const stateDates = state.capacityDates || [];
    const teamDaily = state.teamDailyCapacity || [];
    const projectDaily = state.projectDailyCapacity || [];
    if(stateDates && stateDates.length && teamDaily && projectDaily){
      const dateIndexMap = new Map(stateDates.map((ds,i)=>[ds,i]));
      const totals = new Array(days).fill(0).map(()=> ({ total: 0, perTeam: {}, perProject: {} }));
      for(let i=0;i<days;i++){
        const iso = this._fmtDate(this._addDays(sDate, i));
        const si = dateIndexMap.get(iso);
        if(si === undefined) continue;
        const tTuple = teamDaily[si] || [];
        const pTuple = projectDaily[si] || [];
        let maxTeamVal = 0;
        for(let ti=0; ti<teams.length; ti++){ const tid = teams[ti].id; if(!teamSetSelected.has(tid)) continue; const v = Number(tTuple[ti] || 0); totals[i].perTeam[tid] = v; if(v > maxTeamVal) maxTeamVal = v; }
        let sumProj = 0;
        for(let pi=0; pi<projects.length; pi++){ const pid = projects[pi].id; if(!projectSetSelected.has(pid)) continue; const v = Number(pTuple[pi] || 0); totals[i].perProject[pid] = v; sumProj += v; }
        totals[i].total = (mode === 'team') ? maxTeamVal : sumProj;
      }
      return { days, totals };
    }

    const teamDayMap = new Map(); const projectDayMap = new Map();
    const numTeamsGlobal = teams.length === 0 ? 1 : teams.length;
    function addRawTeam(dayIdx, teamId, raw){ if(dayIdx < 0 || dayIdx >= days) return; if(!teamDayMap.has(dayIdx)) teamDayMap.set(dayIdx, {}); const b = teamDayMap.get(dayIdx); b[teamId] = (b[teamId] || 0) + Number(raw || 0); }
    function addNormalizedProject(dayIdx, projectId, raw){ if(dayIdx < 0 || dayIdx >= days) return; if(!projectDayMap.has(dayIdx)) projectDayMap.set(dayIdx, {}); const b = projectDayMap.get(dayIdx); b[projectId] = (b[projectId] || 0) + (raw / numTeamsGlobal); }

    const featuresByEpic = new Map();
    for(const f of effective){ if(f.type==='feature' && f.parentEpic){ if(!featuresByEpic.has(f.parentEpic)) featuresByEpic.set(f.parentEpic, []); featuresByEpic.get(f.parentEpic).push(f); } }

    const startMs = new Date(sDate).setHours(0,0,0,0);
    const msPerDay = 24*60*60*1000;

    for(const item of effective){
      const itemState = item.status || item.state;
      if(stateSetSelected.size > 0 && !stateSetSelected.has(itemState)) continue;
      const isEpic = item.type === 'epic';
      if(!projectSetSelected.has(item.project)) continue;
      const itemStart = new Date(item.start).setHours(0,0,0,0);
      const itemEnd = new Date(item.end).setHours(0,0,0,0);
      if(isEpic){
        if(!showEpics) continue;
        const children = featuresByEpic.get(item.id) || [];
        const childRanges = (showFeatures && children.length) ? children.map(ch => ({ s: new Date(ch.start).setHours(0,0,0,0), e: new Date(ch.end).setHours(0,0,0,0) })) : [];
        const startIdx = Math.max(0, Math.floor((Math.max(itemStart, startMs) - startMs)/msPerDay));
        const endIdx = Math.min(days-1, Math.floor((Math.min(itemEnd, new Date(eDate).setHours(0,0,0,0)) - startMs)/msPerDay));
        for(let d = startIdx; d <= endIdx; d++){
          const currentDayMs = startMs + d * msPerDay;
          const coveredByChild = showFeatures && childRanges.some(r => currentDayMs >= r.s && currentDayMs <= r.e);
          if(coveredByChild) continue;
          for(const tl of item.capacity || []){ if(!teamSetSelected.has(tl.team)) continue; addRawTeam(d, tl.team, tl.capacity); addNormalizedProject(d, item.project, tl.capacity); }
        }
      } else {
        if(!showFeatures) continue;
        const startIdx = Math.max(0, Math.floor((Math.max(itemStart, startMs) - startMs)/msPerDay));
        const endIdx = Math.min(days-1, Math.floor((Math.min(itemEnd, new Date(eDate).setHours(0,0,0,0)) - startMs)/msPerDay));
        for(let d = startIdx; d <= endIdx; d++){
          for(const tl of item.capacity || []){ if(!teamSetSelected.has(tl.team)) continue; addRawTeam(d, tl.team, tl.capacity); addNormalizedProject(d, item.project, tl.capacity); }
        }
      }
    }

    const totals = new Array(days).fill(0).map(()=> ({ total: 0, perTeam: {}, perProject: {} }));
    for(let i=0;i<days;i++){
      const tmap = teamDayMap.get(i) || {};
      const pmap = projectDayMap.get(i) || {};
      totals[i].perTeam = tmap; totals[i].perProject = pmap;
      const teamVals = Object.values(tmap).map(v=>Number(v||0));
      const tMax = teamVals.length ? Math.max(...teamVals) : 0;
      const pSum = Object.values(pmap).reduce((a,b)=>a+b,0);
      totals[i].total = (mode === 'team') ? tMax : pSum;
    }
    return { days, totals };
  }

  _clearSvg(){ if(this.svgEl) while(this.svgEl.firstChild) this.svgEl.removeChild(this.svgEl.firstChild); }

  _renderAxes(width, height, sDate, eDate, maxY = 100, step = 20){
    const gAxes = document.createElementNS('http://www.w3.org/2000/svg','g'); gAxes.setAttribute('class','mv-axes');
    if(!maxY || maxY <= 0){ maxY = 100; step = 20; }
    const numTicks = Math.ceil(maxY / step);
    for(let i=0;i<=numTicks;i++){
      const val = Math.min(maxY, i * step);
      const yPos = height - (val / maxY) * height;
      const line = document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('x1','0'); line.setAttribute('x2', String(width)); line.setAttribute('y1', String(yPos)); line.setAttribute('y2', String(yPos)); line.setAttribute('stroke','#eee'); line.setAttribute('stroke-width','1'); gAxes.appendChild(line);
      const label = document.createElementNS('http://www.w3.org/2000/svg','text'); label.textContent = `${val}%`; label.setAttribute('x','4'); label.setAttribute('y', String(yPos - 2)); label.setAttribute('fill','#666'); label.setAttribute('font-size','11'); gAxes.appendChild(label);
    }
    const start = new Date(sDate); start.setHours(0,0,0,0);
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const end = new Date(eDate); end.setHours(0,0,0,0);
    const totalDays = this._daysBetween(sDate, eDate);
    while(cursor <= end){
      const dayIndex = Math.max(0, Math.min(totalDays-1, this._daysBetween(sDate, cursor)-1));
      const x = (dayIndex/Math.max(1,totalDays-1)) * width;
      const line = document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x)); line.setAttribute('y1', '0'); line.setAttribute('y2', String(height)); line.setAttribute('stroke','#f2f2f2'); line.setAttribute('stroke-width','1'); gAxes.appendChild(line);
      const lbl = document.createElementNS('http://www.w3.org/2000/svg','text'); lbl.textContent = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`; lbl.setAttribute('x', String(x+18)); lbl.setAttribute('y', String(height + 32)); lbl.setAttribute('fill','#333'); lbl.setAttribute('font-size','11'); lbl.setAttribute('transform', `rotate(-30 ${x+18} ${height + 32})`); lbl.setAttribute('text-anchor', 'start'); gAxes.appendChild(lbl);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1);
    }
    this.svgEl.appendChild(gAxes);
  }

  _renderProjectBars(data, width, height, parent, maxY = 100){
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    const { days, totals } = data;
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }
    const sDateGlobal = new Date(this.startDate);
    const pxPerDay = (date)=> monthWidth / daysInMonth(date);
    const xForDay = (i)=>{
      let cum = 0; const start = new Date(sDateGlobal.getFullYear(), sDateGlobal.getMonth(), sDateGlobal.getDate()); let curDate = new Date(start);
      for(let k=0;k<i;k++){ cum += pxPerDay(curDate); curDate.setDate(curDate.getDate()+1); }
      return Math.floor(cum);
    };
    for(let i=0;i<days;i++){
      const x = xForDay(i); const nextX = xForDay(i+1); const w = Math.max(1, nextX - x);
      const perProj = totals[i].perProject || {}; const entries = Object.entries(perProj);
      let yCursor = height;
      entries.forEach(([pid, val])=>{
        const hSeg = (val / maxY) * height;
        const y = yCursor - hSeg;
        const rect = document.createElementNS('http://www.w3.org/2000/svg','rect'); rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y)); rect.setAttribute('width', String(w)); rect.setAttribute('height', String(hSeg));
        const proj = (state.projects || []).find(p=>p.id===pid);
        rect.setAttribute('fill', proj ? proj.color : '#5481e6');
        rect.addEventListener('pointerenter', ()=> this._showTooltip(i, totals[i]));
        rect.addEventListener('pointermove', (e)=> this._moveTooltip(e));
        rect.addEventListener('pointerleave', ()=> this._hideTooltip());
        g.appendChild(rect);
        yCursor = y;
      });
    }
    (parent || this.svgEl).appendChild(g);
  }

  _renderTeamLines(data, width, height, parent, maxY = 100){
    const teams = state.teams || [];
    const { days, totals } = data;
    const self = this;
    teams.slice(0,Math.min(teams.length, teams.length)).forEach((t, idx)=>{
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      let d = '';
      for(let i=0;i<days;i++){
        const x = this._xForDayGlobal(i);
        const val = (totals[i].perTeam[t.id] || 0);
        const y = height - (val / maxY) * height;
        d += (i===0? `M ${x} ${y}` : ` L ${x} ${y}`);
      }
      path.setAttribute('d', d); path.setAttribute('fill','none'); path.setAttribute('stroke', t.color || ['#ff6','#f66','#6f6'][idx%3]); path.setAttribute('stroke-width','2');
      path.addEventListener('pointerenter', ()=> this._showTooltip(null, null, t));
      path.addEventListener('pointerleave', ()=> this._hideTooltip());
      (parent || this.svgEl).appendChild(path);
    });
  }

  _xForDayGlobal(i){ if(this.dayOffsets && i >= 0 && i < this.dayOffsets.length) return Math.floor(this.dayOffsets[i]); return 0; }

  _showTooltip(dayIndex, totalsForDay, team){
    this.tooltipEl.style.display = 'block'; let html = '';
    if(dayIndex !== null && totalsForDay){
      const date = this._addDays(this.startDate, dayIndex);
      html += `<div style="font-weight:700; margin-bottom:6px;">${new Date(date).toLocaleString()}</div>`;
      html += `<div style="color:#ddd; margin-bottom:6px;">Total: <strong style=\"color:#fff\">${Math.round(totalsForDay.total)}%</strong></div>`;
      if(this.mode === 'project'){
        const per = totalsForDay.perProject || {}; const entries = Object.entries(per).map(([id,v])=>({ id, v })); entries.sort((a,b)=>b.v - a.v);
        if(entries.length){ html += '<div style="display:flex; flex-direction:column; gap:4px;">'; entries.slice(0,10).forEach(e=>{ const p = (state.projects||[]).find(x=>x.id===e.id); const color = p ? p.color : '#888'; const name = p ? p.name : e.id; html += `<div style="display:flex; align-items:center; gap:8px; font-size:12px; color:#eee;"><span style=\"width:10px;height:10px;background:${color};display:inline-block;border-radius:2px;flex:0 0 10px;\"></span><span style=\"flex:1; color:#ddd;\">${name}</span><span style=\"margin-left:8px; color:#fff; font-weight:700;\">${Math.round(e.v)}%</span></div>`; }); html += '</div>'; }
      } else {
        const per = totalsForDay.perTeam || {}; const entries = Object.entries(per).map(([id,v])=>({ id, v })); entries.sort((a,b)=>b.v - a.v);
        if(entries.length){ html += '<div style="display:flex; flex-direction:column; gap:4px;">'; entries.slice(0,10).forEach(e=>{ const t = (state.teams||[]).find(x=>x.id===e.id); const color = t ? t.color : '#888'; const name = t ? t.name : e.id; html += `<div style="display:flex; align-items:center; gap:8px; font-size:12px; color:#eee;"><span style=\"width:10px;height:10px;background:${color};display:inline-block;border-radius:2px;flex:0 0 10px;\"></span><span style=\"flex:1; color:#ddd;\">${name}</span><span style=\"margin-left:8px; color:#fff; font-weight:700;\">${Math.round(e.v)}%</span></div>`; }); html += '</div>'; }
      }
    } else if(team){ html += `<div style="font-weight:700; margin-bottom:6px;">${team.name}</div>`; html += `<div style="color:#ddd;">(team line)</div>`; }
    else { html += `<div style="color:#ddd;">No data</div>`; }
    this.tooltipEl.innerHTML = html;
  }

  _moveTooltip(e){ const offsetX = 12; const offsetY = 12; let left = e.clientX + offsetX + window.scrollX; let top = e.clientY + offsetY + window.scrollY; this.tooltipEl.style.left = `${left}px`; this.tooltipEl.style.top = `${top}px`; const tipRect = this.tooltipEl.getBoundingClientRect(); const tipW = tipRect.width; const tipH = tipRect.height; const winW = window.innerWidth; const winH = window.innerHeight; if(left - window.scrollX + tipW + 8 > winW) left = Math.max(window.scrollX + 4, window.scrollX + winW - tipW - 8); if(top - window.scrollY + tipH + 8 > winH) top = Math.max(window.scrollY + 4, window.scrollY + winH - tipH - 8); this.tooltipEl.style.left = `${left}px`; this.tooltipEl.style.top = `${top}px`; }

  _hideTooltip(){ if(this.tooltipEl) this.tooltipEl.style.display = 'none'; }

  _render(){
    const host = this._ensureSvg(); if(!host) return; this._clearSvg();
    const w = host.clientWidth; const hContent = host.clientHeight; const bottomPad = 56; this.svgEl.setAttribute('viewBox', `0 0 ${w} ${hContent + bottomPad}`);
    const data = this._computeDailyTotals(this.mode, this.startDate, this.endDate);
    console.debug('[plugin-graph] render', { mode: this.mode, startDate: this.startDate, endDate: this.endDate, days: data.days });
    if(!data || !data.days || data.days <= 0){ this._renderAxes(w, hContent, this.startDate, this.endDate, 100, 20); return; }
    this.lastRenderedData = data;
    let maxY = 100; let step = 20;
    if(this.mode === 'project'){ const observedMax = Math.max(...data.totals.map(t=> (t && t.total) || 0)); maxY = (observedMax && observedMax > 0) ? Math.ceil(observedMax) : 100; }
    else { let teamMax = 0; for(const d of data.totals){ const per = d.perTeam || {}; for(const v of Object.values(per)) if(v > teamMax) teamMax = v; } maxY = (teamMax && teamMax > 0) ? Math.ceil(teamMax) : 100; }
    let approx = Math.ceil(maxY / 5); step = Math.ceil(approx / 5) * 5; if(step < 1) step = 1;
    const monthWidth = TIMELINE_CONFIG.monthWidth; function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }
    const daysCount = data.days; this.dayOffsets = new Array(daysCount+1).fill(0); let cum = 0; let cur = new Date(this.startDate.getFullYear(), this.startDate.getMonth(), this.startDate.getDate()); this.dayOffsets[0] = 0; for(let i=0;i<daysCount;i++){ const p = monthWidth / daysInMonth(cur); cum += p; this.dayOffsets[i+1] = cum; cur.setDate(cur.getDate()+1); }
    const totalContentWidth = this.dayOffsets[this.dayOffsets.length-1] || 1; this.xScale = (w / totalContentWidth);
    const rootGroup = document.createElementNS('http://www.w3.org/2000/svg','g'); rootGroup.setAttribute('transform', `scale(${this.xScale},1)`); this.svgEl.appendChild(rootGroup);
    this._renderAxes(w, hContent, this.startDate, this.endDate, maxY, step);
    if(this.mode === 'project') this._renderProjectBars(data, w, hContent, rootGroup, maxY); else this._renderTeamLines(data, w, hContent, rootGroup, maxY);
  }
}

customElements.define('plugin-graph', PluginGraph);
