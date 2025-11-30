import { state } from './state.js';
import { bus } from './eventBus.js';
import { formatDate, parseDate, addMonths } from './util.js';
import { getTimelineMonths } from './timeline.js';
import { startDragMove, startResize } from './dragManager.js';

function laneHeight(){ return state.condensedCards ? 40 : 100; }
const monthWidth = 120;

function getBoardOffset(){
  const board = document.getElementById('featureBoard');
  if(!board) return 0;
  const pl = parseInt(getComputedStyle(board).paddingLeft,10);
  return isNaN(pl)?0:pl;
}

export function initFeatureCards(){
  bus.on('projects:changed', renderFeatureBoard);
  bus.on('teams:changed', renderFeatureBoard);
  bus.on('timeline:months', renderFeatureBoard);
  bus.on('feature:updated', renderFeatureBoard);
  bus.on('filters:changed', renderFeatureBoard);
  bus.on('view:sortMode', renderFeatureBoard);
  bus.on('scenario:activated', ({scenarioId})=>{
    const board = document.getElementById('featureBoard');
    if(!board) return;
    if(scenarioId && scenarioId !== 'baseline') board.classList.add('scenario-mode');
    else board.classList.remove('scenario-mode');
  });
  renderFeatureBoard();
}

function isProjectSelected(id){ return state.projects.find(p=>p.id===id && p.selected); }
function isAnyTeamSelected(feature){ return feature.teamLoads.some(tl => state.teams.find(t=>t.id===tl.team && t.selected)); }

function computePosition(feature){
  const months = getTimelineMonths();
  // Defensive: ensure valid start/end
  let startDate = parseDate(feature.start);
  let endDate = parseDate(feature.end);
  if (!(startDate instanceof Date) || isNaN(startDate.getTime())) startDate = new Date('2025-01-01');
  if (!(endDate instanceof Date) || isNaN(endDate.getTime())) endDate = new Date('2025-01-15');

  // Locate month indices containing start and end
  let startIdx = months.findIndex(m => startDate >= m && startDate < addMonths(m,1));
  if(startIdx < 0) startIdx = startDate < months[0] ? 0 : months.length - 1;
  let endIdx = months.findIndex(m => endDate >= m && endDate < addMonths(m,1));
  if(endIdx < 0) endIdx = endDate < months[0] ? 0 : months.length - 1;

  // Fractional offsets within month based on day-of-month
  function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }
  const startDays = daysInMonth(months[startIdx]);
  const endDays = daysInMonth(months[endIdx]);
  const startFraction = (startDate.getDate()-1) / startDays; // 0 for first day
  // Treat end as inclusive; add fraction of day span
  const endFraction = (endDate.getDate()) / endDays; // 1 for last day

  const boardOffset = getBoardOffset();
  const left = boardOffset + (startIdx + startFraction) * monthWidth;
  const spanContinuous = (endIdx + endFraction) - (startIdx + startFraction);
  let width = spanContinuous * monthWidth;
  const minVisualWidth = 40; // ensure single-day visibility
  if(width < minVisualWidth) width = minVisualWidth;

  return { left, width };
}

function computeFeatureOrgLoad(feature){
  // Org load per card: sum of participating selected team loads divided by total global number of teams.
  const numTeamsGlobal = state.teams.length === 0 ? 1 : state.teams.length;
  let sum = 0;
  for(const tl of feature.teamLoads){
    const t = state.teams.find(x=>x.id===tl.team && x.selected);
    if(!t) continue; // respect team filters for scenario simulation
    sum += tl.load;
  }
  return (sum / numTeamsGlobal).toFixed(1) + '%';
}

function createCard(feature, idx, sourceFeatures){
  const {left, width} = computePosition(feature);
  const card = document.createElement('div');
  card.className = 'feature-card';
  card.style.left = left + 'px';
  card.style.top = (idx * laneHeight()) + 'px';
  card.style.width = width + 'px';
  card.dataset.id = feature.id;
  // Always mark cards as dirty in scenarios if they differ from baseline
  const activeScenario = state.scenarios.find(s=>s.id===state.activeScenarioId);
  const inScenarioMode = !!activeScenario && activeScenario.id !== 'baseline';
  if(feature.dirty){ card.classList.add('dirty'); }
  // Apply project color to left border
  const project = state.projects.find(p=>p.id===feature.project);
  if(project){ card.style.borderLeftColor = project.color; }

  if(state.condensedCards){
    card.classList.add('condensed');
  }
  let datesEl = null;
  if(!state.condensedCards){
    const teamRow = document.createElement('div'); teamRow.className='team-load-row';
    const orgBox = document.createElement('span'); orgBox.className='team-load-box'; orgBox.style.background='#23344d'; orgBox.textContent = computeFeatureOrgLoad(feature); teamRow.appendChild(orgBox);
    feature.teamLoads.forEach(tl=>{ const t= state.teams.find(x=>x.id===tl.team && x.selected); if(!t) return; const box = document.createElement('span'); box.className='team-load-box'; box.style.background = t.color; box.textContent = tl.load; teamRow.appendChild(box); });
    card.appendChild(teamRow);
  }
  // Title row with type icon
  const titleRow = document.createElement('div'); titleRow.className='title-row';
  const typeIcon = document.createElement('span'); typeIcon.className='type-icon ' + (feature.type === 'epic' ? 'epic' : 'feature');
  if(feature.type === 'epic') {
    // Yellow crown emoji
    typeIcon.textContent = '👑';
  } else {
    // Purple chalice (inline SVG for consistent coloring)
    typeIcon.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M7 3h10v3c0 2.761-2.239 5-5 5s-5-2.239-5-5V3zm5 10c3.314 0 6-2.686 6-6V2H6v5c0 3.314 2.686 6 6 6zm-3.5 2h7a.5.5 0 01.5.5c0 .828-.672 1.5-1.5 1.5h-5a1.5 1.5 0 01-1.5-1.5.5.5 0 01.5-.5zm-1.75 4h11.5c.276 0 .5.224.5.5v1c0 .276-.224.5-.5.5H6.75a.5.5 0 01-.5-.5v-1c0-.276.224-.5.5-.5z"/></svg>';
  }
  titleRow.appendChild(typeIcon);
  const title = document.createElement('div'); title.className='feature-title'; title.textContent = feature.title; title.setAttribute('title', feature.title); titleRow.appendChild(title);
  card.appendChild(titleRow);
  if(!state.condensedCards){
    datesEl = document.createElement('div');
    datesEl.className='feature-dates';
    datesEl.textContent = feature.start + ' → ' + feature.end;
    card.appendChild(datesEl);
  }

  const resizeHandle = document.createElement('div'); resizeHandle.className='drag-handle'; card.appendChild(resizeHandle);
  // Unified click/drag handling with threshold
  // Scenario override wiring: if active scenario is non-live, route updates to overrides
  // Reuse scenario mode detection for drag callbacks.
  const updateDatesCb = (id,start,end)=> state.updateFeatureDates(id,start,end); // unified override handler
  const featuresSource = sourceFeatures;

  card.addEventListener('mousedown', e => {
    if(e.target===resizeHandle) return; // resize handled separately
    e.stopPropagation();
    const startX = e.clientX;
    let isDragging = false;

    function cleanupTemp(){ window.removeEventListener('mousemove', onPreMove); window.removeEventListener('mouseup', onPreUp); }

    function onPreMove(ev){
      const dx = ev.clientX - startX;
      if(Math.abs(dx) > 5){
        isDragging = true;
        cleanupTemp();
        // initiate drag (original behavior)
        startDragMove(e, feature, card, updateDatesCb, featuresSource);
      }
    }

    function onPreUp(){
      cleanupTemp();
      if(!isDragging){
        // treat as click
        document.querySelectorAll('.feature-card').forEach(c=>c.classList.remove('selected'));
        card.classList.add('selected');
        bus.emit('details:show', feature);
      }
    }

    window.addEventListener('mousemove', onPreMove);
    window.addEventListener('mouseup', onPreUp);
  });
  resizeHandle.addEventListener('mousedown', e => { e.stopPropagation(); startResize(e, feature, card, datesEl, updateDatesCb, featuresSource); });

  // Observe width changes to toggle narrow class for fade/clamp styling
  const ro = new ResizeObserver(entries => {
    for(const entry of entries){
      const w = entry.contentRect.width;
      if(w < 160){ card.classList.add('narrow'); }
      else { card.classList.remove('narrow'); }
      // Cull title entirely if card is too narrow to meaningfully display it
      if(w < 80){ card.classList.add('culled'); }
      else { card.classList.remove('culled'); }
    }
  });
  ro.observe(card);

  return card;
}

function renderFeatureBoard(){
  const board = document.getElementById('featureBoard'); if(!board) return; board.innerHTML='';
  let ordered;
  const sourceFeatures = state.getEffectiveFeatures();
  if(state.featureSortMode === 'rank'){
    // Group epics with their children preserving original import rank
    const epics = sourceFeatures.filter(f => f.type === 'epic').sort((a,b)=> (a.originalRank||0)-(b.originalRank||0));
    const childrenByEpic = new Map();
    sourceFeatures.forEach(f => { if(f.type==='feature' && f.parentEpic){ if(!childrenByEpic.has(f.parentEpic)) childrenByEpic.set(f.parentEpic, []); childrenByEpic.get(f.parentEpic).push(f); } });
    for(const arr of childrenByEpic.values()) arr.sort((a,b)=> (a.originalRank||0)-(b.originalRank||0));
    const standalone = sourceFeatures.filter(f => f.type==='feature' && !f.parentEpic).sort((a,b)=> (a.originalRank||0)-(b.originalRank||0));
    ordered = [];
    for(const epic of epics){ ordered.push(epic); const kids = childrenByEpic.get(epic.id)||[]; ordered.push(...kids); }
    ordered.push(...standalone);
  } else {
    // Date ordering groups epics with their children
    const epics = sourceFeatures.filter(f => f.type === 'epic').sort((a,b)=> a.start.localeCompare(b.start));
    const childrenByEpic = new Map();
    sourceFeatures.forEach(f => {
      if(f.type === 'feature' && f.parentEpic){
        if(!childrenByEpic.has(f.parentEpic)) childrenByEpic.set(f.parentEpic, []);
        childrenByEpic.get(f.parentEpic).push(f);
      }
    });
    for(const arr of childrenByEpic.values()) arr.sort((a,b)=> a.start.localeCompare(b.start));
    const standalone = sourceFeatures.filter(f => f.type === 'feature' && !f.parentEpic).sort((a,b)=> a.start.localeCompare(b.start));
    ordered = [];
    for(const epic of epics){
      ordered.push(epic);
      const kids = childrenByEpic.get(epic.id) || [];
      ordered.push(...kids);
    }
    ordered.push(...standalone);
  }
  let idx=0;
  // For visibility checks we still need children mapping for epic visibility
  const mapChildren = new Map();
  sourceFeatures.forEach(f => { if(f.type==='feature' && f.parentEpic){ if(!mapChildren.has(f.parentEpic)) mapChildren.set(f.parentEpic, []); mapChildren.get(f.parentEpic).push(f); } });
  for(const f of ordered){
    if(!isProjectSelected(f.project)) continue;
    if(f.type === 'epic' && !state.showEpics) continue;
    if(f.type === 'feature' && !state.showFeatures) continue;
    if(f.type === 'epic'){
      const kids = mapChildren.get(f.id) || [];
      const anyChildVisible = kids.some(ch => isProjectSelected(ch.project) && isAnyTeamSelected(ch));
      const epicVisible = isAnyTeamSelected(f) || anyChildVisible;
      if(!epicVisible) continue;
    } else {
      if(!isAnyTeamSelected(f)) continue;
    }
    board.appendChild(createCard(f, idx, sourceFeatures)); idx++;
  }
}
