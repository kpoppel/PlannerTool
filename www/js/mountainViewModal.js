import { state } from './state.js';
import { bus } from './eventBus.js';
import { getTimelineMonths, TIMELINE_CONFIG } from './timeline.js';

let svgEl = null;
let tooltipEl = null;
let currentMode = 'project'; // 'project' stacked bars, 'team' lines
let startDate = null;
let endDate = null;
let _savedMainStyles = null;
let dayOffsets = null;
let lastRenderedData = null;
let xScale = 1;

function ensureElements() {
  const host = document.getElementById('mountainViewHost');
  if (!host) return null;
  if (!svgEl) {
    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('preserveAspectRatio', 'none');
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';
    host.appendChild(svgEl);
    // Pointer tracking for hover tooltips (map x -> day index)
    svgEl.addEventListener('pointermove', (e)=>{
      if(!dayOffsets) return;
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left;
      const unscaledX = x / (xScale || 1);
      // find day index
      let lo = 0, hi = dayOffsets.length-1;
      while(lo < hi){ const mid = Math.floor((lo+hi)/2); if(dayOffsets[mid] <= unscaledX) lo = mid+1; else hi = mid; }
      const dayIdx = Math.max(0, lo-1);
      if(dayIdx >=0 && dayIdx < dayOffsets.length-1){
        // compute totals array index
        showTooltip(dayIdx, (lastRenderedData && lastRenderedData.totals) ? lastRenderedData.totals[dayIdx] : null);
        moveTooltip(e);
      }
    });
    svgEl.addEventListener('pointerleave', ()=>{ hideTooltip(); });
  }
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    // attach tooltip to body so HTML content renders reliably and does not get mangled by SVG contexts
    document.body.appendChild(tooltipEl);
  }
  // Reapply tooltip styles in case tooltip was created earlier (hot reload / existing DOM)
  tooltipEl.style.zIndex = '10000';
  tooltipEl.style.position = 'absolute';
  tooltipEl.style.pointerEvents = 'none';
  tooltipEl.style.background = 'rgba(0,0,0,0.75)';
  tooltipEl.style.color = '#fff';
  tooltipEl.style.padding = '8px 10px';
  tooltipEl.style.borderRadius = '6px';
  tooltipEl.style.fontSize = '12px';
  tooltipEl.style.display = 'none';
  tooltipEl.style.whiteSpace = 'normal';
  tooltipEl.style.wordBreak = 'break-word';
  tooltipEl.style.maxWidth = '360px';
  tooltipEl.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
  tooltipEl.style.lineHeight = '1.25';
  if(tooltipEl.parentElement !== document.body) document.body.appendChild(tooltipEl);
  return host;
}

// Create the modal DOM structure dynamically if index.html only contains a placeholder.
function ensureModalDom(){
  const modal = document.getElementById('mountainViewModal');
  if(!modal) return null;
  // If modal already has the host, assume DOM is already created
  if(document.getElementById('mountainViewHost')) return modal;
  modal.style.display = 'none';
  modal.style.position = 'absolute';
  modal.style.left = '0'; modal.style.top = '0'; modal.style.right = '0'; modal.style.bottom = '0';
  modal.style.inset = '0';
  modal.style.zIndex = '50';
  modal.style.overflow = 'hidden';
  modal.style.padding = '0';
  modal.style.boxSizing = 'border-box';
  modal.style.display = 'none';
  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.margin = '0';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.background = 'transparent';
  container.style.paddingLeft = '8px';
  container.style.paddingRight = '8px';
  container.style.boxSizing = 'border-box';
  container.style.borderRadius = '0';

  const title = document.createElement('h3'); title.textContent = 'Mountain View (SVG)';
  container.appendChild(title);

  const fieldRow = document.createElement('div');
  fieldRow.className = 'modal-field';
  fieldRow.style.display = 'flex'; fieldRow.style.gap = '12px'; fieldRow.style.alignItems = 'center'; fieldRow.style.justifyContent = 'center'; fieldRow.style.flexWrap = 'nowrap'; fieldRow.style.flex = '0 0 auto'; fieldRow.style.padding = '8px 12px';

  const inner = document.createElement('div'); inner.style.width = '100%'; inner.style.display = 'flex'; inner.style.gap = '8px'; inner.style.alignItems = 'center';

  const leftGroup = document.createElement('div'); leftGroup.style.display = 'flex'; leftGroup.style.gap = '8px'; leftGroup.style.alignItems = 'center'; leftGroup.style.whiteSpace = 'nowrap'; leftGroup.style.flex = '0 0 auto';
  const rangeLabel = document.createElement('span'); rangeLabel.style.fontWeight = '600'; rangeLabel.style.marginTop = '8px'; rangeLabel.textContent = 'Date Range';
  const mvStart = document.createElement('input'); mvStart.id = 'mvStart'; mvStart.type = 'date'; mvStart.style.width = '150px'; mvStart.style.minWidth = '120px';
  const dash = document.createElement('span'); dash.textContent = ' - ';
  const mvEnd = document.createElement('input'); mvEnd.id = 'mvEnd'; mvEnd.type = 'date'; mvEnd.style.width = '150px'; mvEnd.style.minWidth = '120px';
  const applyBtn = document.createElement('button'); applyBtn.id = 'mvApply'; applyBtn.type = 'button'; applyBtn.textContent = 'Apply';
  leftGroup.appendChild(rangeLabel); leftGroup.appendChild(mvStart); leftGroup.appendChild(dash); leftGroup.appendChild(mvEnd); leftGroup.appendChild(applyBtn);

  const rightGroup = document.createElement('div'); rightGroup.style.marginLeft = 'auto'; rightGroup.style.display = 'flex'; rightGroup.style.gap = '8px'; rightGroup.style.alignItems = 'center'; rightGroup.style.flex = '0 0 auto';
  const exportSvgBtn = document.createElement('button'); exportSvgBtn.id = 'mvExportSvg'; exportSvgBtn.type = 'button'; exportSvgBtn.textContent = 'Export SVG';
  const exportPngBtn = document.createElement('button'); exportPngBtn.id = 'mvExportPng'; exportPngBtn.type = 'button'; exportPngBtn.textContent = 'Export PNG';
  rightGroup.appendChild(exportSvgBtn); rightGroup.appendChild(exportPngBtn);

  inner.appendChild(leftGroup); inner.appendChild(rightGroup);
  fieldRow.appendChild(inner);
  container.appendChild(fieldRow);

  const host = document.createElement('div'); host.id = 'mountainViewHost'; host.style.width = '100%'; host.style.flex = '1 1 auto'; host.style.minHeight = '0'; host.style.border = '0'; host.style.background = 'transparent'; host.style.position = 'relative'; host.style.boxSizing = 'border-box';
  container.appendChild(host);

  modal.appendChild(container);

  // Wire events to existing functions
  applyBtn.addEventListener('click', ()=>{ startDate = new Date(mvStart.value); endDate = new Date(mvEnd.value); render(); });
  exportSvgBtn.addEventListener('click', exportSvg);
  exportPngBtn.addEventListener('click', exportPng);
  return modal;
}

function daysBetween(d0, d1){
  const ms = new Date(d1).setHours(0,0,0,0) - new Date(d0).setHours(0,0,0,0);
  return Math.max(0, Math.floor(ms / (24*3600*1000)) + 1);
}
function addDays(d, n){ const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt; }
function fmtDate(d){ const dd = new Date(d); return dd.toISOString().slice(0,10); }

function computeDailyTotals(mode, sDate, eDate){
  // Local aggregation to avoid relying on timeline months cache. Produces normalized per-day maps.
  const effective = state.getEffectiveFeatures();
  const teams = state.teams || [];
  const projects = state.projects || [];
  const showEpics = !!state.showEpics;
  const showFeatures = !!state.showFeatures;
  // If no explicit selections, treat it as all selected to mirror main view behavior
  const selectedTeams = teams.filter(t=>t.selected).map(t=>t.id);
  const selectedProjects = projects.filter(p=>p.selected).map(p=>p.id);
  const teamSetSelected = new Set(selectedTeams.length ? selectedTeams : teams.map(t=>t.id));
  const projectSetSelected = new Set(selectedProjects.length ? selectedProjects : projects.map(p=>p.id));

  const days = daysBetween(sDate, eDate);

  // If precomputed state arrays exist, use them for faster, authoritative rendering
  const stateDates = state.capacityDates || [];
  const teamDaily = state.teamDailyCapacity || [];
  const projectDaily = state.projectDailyCapacity || [];
  const totalOrgPerTeam = state.totalOrgDailyPerTeamAvg || [];
  if(stateDates && stateDates.length && teamDaily && projectDaily){
    // Map state date -> index
    const dateIndexMap = new Map(stateDates.map((ds,i)=>[ds,i]));
    const totals = new Array(days).fill(0).map(()=> ({ total: 0, perTeam: {}, perProject: {} }));
    for(let i=0;i<days;i++){
      const iso = fmtDate(addDays(sDate, i));
      const si = dateIndexMap.get(iso);
      if(si === undefined) continue;
      const tTuple = teamDaily[si] || [];
      const pTuple = projectDaily[si] || [];
      // build per-team map (use raw team values)
      let maxTeamVal = 0;
      for(let ti=0; ti<teams.length; ti++){
        const tid = teams[ti].id;
        if(!teamSetSelected.has(tid)) continue;
        const v = Number(tTuple[ti] || 0);
        totals[i].perTeam[tid] = v;
        if(v > maxTeamVal) maxTeamVal = v;
      }
      // build per-project map (projectDaily is already normalized per-team)
      let sumProj = 0;
      for(let pi=0; pi<projects.length; pi++){
        const pid = projects[pi].id;
        if(!projectSetSelected.has(pid)) continue;
        const v = Number(pTuple[pi] || 0);
        totals[i].perProject[pid] = v;
        sumProj += v;
      }
      totals[i].total = (mode === 'team') ? maxTeamVal : sumProj;
    }
    return { days, totals };
  }

  // Fallback: compute from features (original behavior)
  const teamDayMap = new Map(); // dayIdx -> {teamId: normalized}
  const projectDayMap = new Map();

  const numTeamsGlobal = teams.length === 0 ? 1 : teams.length;
  // Helper to add values. Team loads are stored as raw percentages (do NOT divide by numTeamsGlobal).
  function addRawTeam(dayIdx, teamId, raw){
    if(dayIdx < 0 || dayIdx >= days) return;
    if(!teamDayMap.has(dayIdx)) teamDayMap.set(dayIdx, {});
    const b = teamDayMap.get(dayIdx);
    b[teamId] = (b[teamId] || 0) + Number(raw || 0);
  }
  function addNormalizedProject(dayIdx, projectId, raw){
    if(dayIdx < 0 || dayIdx >= days) return;
    if(!projectDayMap.has(dayIdx)) projectDayMap.set(dayIdx, {});
    const b = projectDayMap.get(dayIdx);
    b[projectId] = (b[projectId] || 0) + (raw / numTeamsGlobal);
  }

  // Build features-by-epic map
  const featuresByEpic = new Map();
  for(const f of effective){ if(f.type==='feature' && f.parentEpic){ if(!featuresByEpic.has(f.parentEpic)) featuresByEpic.set(f.parentEpic, []); featuresByEpic.get(f.parentEpic).push(f); } }

  const startMs = new Date(sDate).setHours(0,0,0,0);
  const msPerDay = 24*60*60*1000;

  for(const item of effective){
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
        for(const tl of item.teamLoads || []){ if(!teamSetSelected.has(tl.team)) continue; addRawTeam(d, tl.team, tl.load); addNormalizedProject(d, item.project, tl.load); }
      }
    } else {
      if(!showFeatures) continue;
      const startIdx = Math.max(0, Math.floor((Math.max(itemStart, startMs) - startMs)/msPerDay));
      const endIdx = Math.min(days-1, Math.floor((Math.min(itemEnd, new Date(eDate).setHours(0,0,0,0)) - startMs)/msPerDay));
      for(let d = startIdx; d <= endIdx; d++){
        for(const tl of item.teamLoads || []){ if(!teamSetSelected.has(tl.team)) continue; addRawTeam(d, tl.team, tl.load); addNormalizedProject(d, item.project, tl.load); }
      }
    }
  }

  // Build totals array
  const totals = new Array(days).fill(0).map(()=> ({ total: 0, perTeam: {}, perProject: {} }));
  for(let i=0;i<days;i++){
    const tmap = teamDayMap.get(i) || {};
    const pmap = projectDayMap.get(i) || {};
    totals[i].perTeam = tmap;
    totals[i].perProject = pmap;
    // For team mode, use the maximum single-team contribution for the day's total (so overload flags per-team overloads).
    const teamVals = Object.values(tmap).map(v=>Number(v||0));
    const tMax = teamVals.length ? Math.max(...teamVals) : 0;
    const pSum = Object.values(pmap).reduce((a,b)=>a+b,0);
    totals[i].total = (mode === 'team') ? tMax : pSum;
  }
  return { days, totals };
}

function clearSvg(){ while(svgEl.firstChild) svgEl.removeChild(svgEl.firstChild); }

function renderAxes(width, height, sDate, eDate, maxY = 100, step = 20){
  const gAxes = document.createElementNS('http://www.w3.org/2000/svg','g');
  gAxes.setAttribute('class','mv-axes');
  // guard against zero range
  if(!maxY || maxY <= 0){ maxY = 100; step = 20; }
  // compute number of ticks based on step
  const numTicks = Math.ceil(maxY / step);
  for(let i=0;i<=numTicks;i++){
    const val = Math.min(maxY, i * step);
    const yPos = height - (val / maxY) * height;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1','0'); line.setAttribute('x2', String(width));
    line.setAttribute('y1', String(yPos)); line.setAttribute('y2', String(yPos));
    line.setAttribute('stroke','#eee'); line.setAttribute('stroke-width','1');
    gAxes.appendChild(line);
    const label = document.createElementNS('http://www.w3.org/2000/svg','text');
    label.textContent = `${val}%`;
    label.setAttribute('x','4'); label.setAttribute('y', String(yPos - 2));
    label.setAttribute('fill','#666'); label.setAttribute('font-size','11');
    gAxes.appendChild(label);
  }
  // X-axis month ticks (positioned proportional to calendar days)
  const start = new Date(sDate); start.setHours(0,0,0,0);
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(eDate); end.setHours(0,0,0,0);
  const totalDays = daysBetween(sDate, eDate);
  while(cursor <= end){
    const dayIndex = Math.max(0, Math.min(totalDays-1, daysBetween(sDate, cursor)-1));
    const x = (dayIndex/Math.max(1,totalDays-1)) * width;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x));
    line.setAttribute('y1', '0'); line.setAttribute('y2', String(height));
    line.setAttribute('stroke','#f2f2f2'); line.setAttribute('stroke-width','1');
    gAxes.appendChild(line);
    const lbl = document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.textContent = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`;
    lbl.setAttribute('x', String(x+18));
    // labels placed below axis; reserve extra bottom space outside main height
    lbl.setAttribute('y', String(height + 32));
    lbl.setAttribute('fill','#333'); lbl.setAttribute('font-size','11');
    lbl.setAttribute('transform', `rotate(-30 ${x+18} ${height + 32})`);
    lbl.setAttribute('text-anchor', 'start');
    gAxes.appendChild(lbl);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1);
  }
  svgEl.appendChild(gAxes);
}

function renderProjectBars(data, width, height, parent, maxY = 100){
  const g = document.createElementNS('http://www.w3.org/2000/svg','g');
  const { days, totals } = data;
  // Use timeline-aware per-day widths so SVG aligns with main timeline
  const months = getTimelineMonths();
  const monthWidth = TIMELINE_CONFIG.monthWidth;
  function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }
  function pxPerDay(date){ return monthWidth / daysInMonth(date); }
  function xForDay(i){
    // cumulative from start date
    let cum = 0;
    const start = new Date(sDateGlobal.getFullYear(), sDateGlobal.getMonth(), sDateGlobal.getDate());
    let curDate = new Date(start);
    for(let k=0;k<i;k++){ cum += pxPerDay(curDate); curDate.setDate(curDate.getDate()+1); }
    return Math.floor(cum);
  }
  for(let i=0;i<days;i++){
    const x = xForDay(i);
    const nextX = xForDay(i+1);
    const w = Math.max(1, nextX - x);
    // stacked segments per project using project colors
    const perProj = totals[i].perProject || {};
    const entries = Object.entries(perProj);
    // sort optional for stability
    let yCursor = height;
    entries.forEach(([pid, val])=>{
      const hSeg = (val / maxY) * height;
      const y = yCursor - hSeg;
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(w)); rect.setAttribute('height', String(hSeg));
      const proj = (state.projects || []).find(p=>p.id===pid);
      rect.setAttribute('fill', proj ? proj.color : '#5481e6');
      rect.addEventListener('pointerenter', ()=> showTooltip(i, totals[i]));
      rect.addEventListener('pointermove', (e)=> moveTooltip(e));
      rect.addEventListener('pointerleave', hideTooltip);
      g.appendChild(rect);
      yCursor = y;
    });
  }
  (parent || svgEl).appendChild(g);
}

function renderTeamLines(data, width, height, parent, maxY = 100){
  const teams = state.teams || [];
  const { days, totals } = data;
  teams.slice(0,Math.min(teams.length, teams.length)).forEach((t, idx)=>{
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    let d = '';
    for(let i=0;i<days;i++){
      const x = xForDayGlobal(i);
      const val = (totals[i].perTeam[t.id] || 0);
      const y = height - (val / maxY) * height;
      d += (i===0? `M ${x} ${y}` : ` L ${x} ${y}`);
    }
    path.setAttribute('d', d);
    path.setAttribute('fill','none');
    path.setAttribute('stroke', t.color || ['#ff6','#f66','#6f6'][idx%3]);
    path.setAttribute('stroke-width','2');
    path.addEventListener('pointerenter', ()=> showTooltip(null, null, t));
    path.addEventListener('pointerleave', hideTooltip);
    (parent || svgEl).appendChild(path);
  });
}

// Globals used by render helpers (populated on render)
let sDateGlobal = new Date();
let eDateGlobal = new Date();
function xForDayGlobal(i){
  if(dayOffsets && i >= 0 && i < dayOffsets.length) return Math.floor(dayOffsets[i]);
  return 0;
}

function showTooltip(dayIndex, totalsForDay, team){
  tooltipEl.style.display = 'block';
  // Build HTML content
  let html = '';
  if(dayIndex !== null && totalsForDay){
    const date = addDays(startDate, dayIndex);
    html += `<div style="font-weight:700; margin-bottom:6px;">${new Date(date).toLocaleString()}</div>`;
    html += `<div style="color:#ddd; margin-bottom:6px;">Total: <strong style=\"color:#fff\">${Math.round(totalsForDay.total)}%</strong></div>`;
    // per-project or per-team breakdown depending on mode
    if(currentMode === 'project'){
      const per = totalsForDay.perProject || {};
      const entries = Object.entries(per).map(([id,v])=>({ id, v }));
      entries.sort((a,b)=>b.v - a.v);
      if(entries.length){
        html += '<div style="display:flex; flex-direction:column; gap:4px;">';
        entries.slice(0,10).forEach(e=>{
          const p = (state.projects||[]).find(x=>x.id===e.id);
          const color = p ? p.color : '#888';
          const name = p ? p.name : e.id;
          html += `<div style="display:flex; align-items:center; gap:8px; font-size:12px; color:#eee;"><span style=\"width:10px;height:10px;background:${color};display:inline-block;border-radius:2px;flex:0 0 10px;\"></span><span style=\"flex:1; color:#ddd;\">${name}</span><span style=\"margin-left:8px; color:#fff; font-weight:700;\">${Math.round(e.v)}%</span></div>`;
        });
        html += '</div>';
      }
    } else {
      const per = totalsForDay.perTeam || {};
      const entries = Object.entries(per).map(([id,v])=>({ id, v }));
      entries.sort((a,b)=>b.v - a.v);
      if(entries.length){
        html += '<div style="display:flex; flex-direction:column; gap:4px;">';
        entries.slice(0,10).forEach(e=>{
          const t = (state.teams||[]).find(x=>x.id===e.id);
          const color = t ? t.color : '#888';
          const name = t ? t.name : e.id;
          html += `<div style="display:flex; align-items:center; gap:8px; font-size:12px; color:#eee;"><span style=\"width:10px;height:10px;background:${color};display:inline-block;border-radius:2px;flex:0 0 10px;\"></span><span style=\"flex:1; color:#ddd;\">${name}</span><span style=\"margin-left:8px; color:#fff; font-weight:700;\">${Math.round(e.v)}%</span></div>`;
        });
        html += '</div>';
      }
    }
  } else if(team){
    // show single team info
    html += `<div style="font-weight:700; margin-bottom:6px;">${team.name}</div>`;
    html += `<div style="color:#ddd;">(team line)</div>`;
  } else {
    html += `<div style="color:#ddd;">No data</div>`;
  }
  tooltipEl.innerHTML = html;
}
function moveTooltip(e){
  // Position tooltip in page coordinates (attach to body). Clamp to window bounds.
  const offsetX = 12; const offsetY = 12;
  let left = e.clientX + offsetX + window.scrollX;
  let top = e.clientY + offsetY + window.scrollY;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
  const tipRect = tooltipEl.getBoundingClientRect();
  const tipW = tipRect.width; const tipH = tipRect.height;
  const winW = window.innerWidth; const winH = window.innerHeight;
  // clamp horizontally
  if(left - window.scrollX + tipW + 8 > winW) left = Math.max(window.scrollX + 4, window.scrollX + winW - tipW - 8);
  // clamp vertically
  if(top - window.scrollY + tipH + 8 > winH) top = Math.max(window.scrollY + 4, window.scrollY + winH - tipH - 8);
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}
function hideTooltip(){ tooltipEl.style.display = 'none'; }

function render(){
  const host = ensureElements();
  if(!host) return;
  clearSvg();
  const w = host.clientWidth; const hContent = host.clientHeight;
  const bottomPad = 56; // extra space for slanted month labels
  svgEl.setAttribute('viewBox', `0 0 ${w} ${hContent + bottomPad}`);
  // Ensure global start/end for helper functions
  sDateGlobal = new Date(startDate);
  eDateGlobal = new Date(endDate);
  const data = computeDailyTotals(currentMode, startDate, endDate);
  // Basic sanity logs to help debug empty renderings
  console.debug('[mountainView] render', { mode: currentMode, startDate, endDate, days: data.days, teams: (state.teams||[]).filter(t=>t.selected).length, projects: (state.projects||[]).filter(p=>p.selected).length, features: state.getEffectiveFeatures().length });
  if(!data || !data.days || data.days <= 0){
    // still draw axes for the range (use default max 100)
    renderAxes(w, hContent, startDate, endDate, 100, 20);
    return;
  }
  // keep last rendered data for tooltip lookups
  lastRenderedData = data;
  // compute mode-specific observed max Y
  let maxY = 100;
  let step = 20;
  if(currentMode === 'project'){
    const observedMax = Math.max(...data.totals.map(t=> (t && t.total) || 0));
    maxY = (observedMax && observedMax > 0) ? Math.ceil(observedMax) : 100;
  } else {
    // team mode: find the maximum single-team contribution across all days
    let teamMax = 0;
    for(const d of data.totals){
      const per = d.perTeam || {};
      for(const v of Object.values(per)) if(v > teamMax) teamMax = v;
    }
    maxY = (teamMax && teamMax > 0) ? Math.ceil(teamMax) : 100;
  }
  // pick step roughly to produce ~5 ticks, round to multiple of 5 for neat labels
  let approx = Math.ceil(maxY / 5);
  step = Math.ceil(approx / 5) * 5;
  if(step < 1) step = 1;
  // Debug: log observed maxima to help diagnose y-axis scaling issues
  try{ console.debug('[mountainView] scale', { mode: currentMode, maxY, step, sampleDay0: data.totals[0] }); }catch(e){}
  // Precompute day offsets (cumulative x positions) using timeline month widths
  const months = getTimelineMonths();
  const monthWidth = TIMELINE_CONFIG.monthWidth;
  function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }
  function pxPerDay(date){ return monthWidth / daysInMonth(date); }
  const daysCount = data.days;
  dayOffsets = new Array(daysCount+1).fill(0);
  let cum = 0;
  let cur = new Date(sDateGlobal.getFullYear(), sDateGlobal.getMonth(), sDateGlobal.getDate());
  dayOffsets[0] = 0;
  for(let i=0;i<daysCount;i++){
    const p = pxPerDay(cur);
    cum += p;
    dayOffsets[i+1] = cum;
    cur.setDate(cur.getDate()+1);
  }
  // Scale to available SVG width so paths fill container width exactly
  const totalContentWidth = dayOffsets[dayOffsets.length-1] || 1;
  xScale = w / totalContentWidth;
  // apply scaling transform to root group instead of scaling each coordinate
  const rootGroup = document.createElementNS('http://www.w3.org/2000/svg','g');
  rootGroup.setAttribute('transform', `scale(${xScale},1)`);
  svgEl.appendChild(rootGroup);
  renderAxes(w, hContent, startDate, endDate, maxY, step);
  if(currentMode === 'project') renderProjectBars(data, w, hContent, rootGroup, maxY);
  else renderTeamLines(data, w, hContent, rootGroup, maxY);
}

export function openMountainView(mode='project'){
  currentMode = mode;
  const modal = document.getElementById('mountainViewModal');
  ensureModalDom();
  const startInp = document.getElementById('mvStart');
  const endInp = document.getElementById('mvEnd');
  const applyBtn = document.getElementById('mvApply');
  const exportSvgBtn = document.getElementById('mvExportSvg');
  const exportPngBtn = document.getElementById('mvExportPng');
  if(!modal) return;
  // Hide main's other children so the modal can occupy the full main area
  const main = document.getElementById('main');
  if(main && !_savedMainStyles){
    _savedMainStyles = [];
    Array.from(main.children).forEach(child => {
      if(child.id === 'mountainViewModal') return;
      _savedMainStyles.push({ el: child, display: child.style.display || '' });
      child.style.display = 'none';
    });
  }
  // Default range from state (fallback: today..+30d)
  // Prefer timeline months if available so the modal matches the timeline range
  const months = getTimelineMonths();
  let d0;
  let d1;
  if(months && months.length){
    d0 = months[0];
    const last = months[months.length-1];
    // end of last month
    d1 = new Date(last.getFullYear(), last.getMonth()+1, 0);
  } else {
    d0 = new Date();
    d1 = new Date(Date.now() + 30*24*3600*1000);
  }
  startDate = new Date(d0); endDate = new Date(d1);
  if(startInp) startInp.value = fmtDate(startDate);
  if(endInp) endInp.value = fmtDate(endDate);
  if(applyBtn) applyBtn.onclick = ()=>{ startDate = new Date(startInp.value); endDate = new Date(endInp.value); render(); };
  if(exportSvgBtn) exportSvgBtn.onclick = exportSvg;
  if(exportPngBtn) exportPngBtn.onclick = exportPng;
  modal.style.display = 'flex';
  render();
}

export function exportSvg(){
  if(!svgEl) return;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const blob = new Blob([svgStr], { type:'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'mountain-view.svg'; a.click();
  URL.revokeObjectURL(url);
}

export function exportPng(){
  if(!svgEl) return;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const img = new Image();
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  img.onload = function(){
    const host = document.getElementById('mountainViewHost');
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal ? svgEl.viewBox.baseVal : null;
    const w = vb ? vb.width : host.clientWidth;
    const h = vb ? vb.height : host.clientHeight;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
    canvas.toBlob((blob)=>{
      const dl = document.createElement('a'); const u = URL.createObjectURL(blob);
      dl.href = u; dl.download = 'mountain-view.png'; dl.click(); URL.revokeObjectURL(u);
    }, 'image/png');
  };
  img.src = url;
}

export function closeMountainView(){
  const modal = document.getElementById('mountainViewModal');
  if(modal) modal.style.display = 'none';
  const main = document.getElementById('main');
  if(main && _savedMainStyles){
    _savedMainStyles.forEach(s => { s.el.style.display = s.display; });
    _savedMainStyles = null;
  }
}

// Keep modal in sync with selections on main screen
bus.on('projects:changed', ()=>{ if(document.getElementById('mountainViewModal')?.style.display !== 'none') render(); });
bus.on('teams:changed', ()=>{ if(document.getElementById('mountainViewModal')?.style.display !== 'none') render(); });
bus.on('states:changed', ()=>{ if(document.getElementById('mountainViewModal')?.style.display !== 'none') render(); });
bus.on('view:loadMode', (mode)=>{ if(document.getElementById('mountainViewModal')?.style.display !== 'none'){ currentMode = mode; render(); } });
// Re-render when filters change (e.g., toggling Epics/Features)
bus.on('filters:changed', ()=>{ if(document.getElementById('mountainViewModal')?.style.display !== 'none') render(); });
