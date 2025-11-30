import { state } from './state.js';
import { bus } from './eventBus.js';

// Simple palette; can extend later or fetch from config
const PALETTE = ['#3498db','#e74c3c','#27ae60','#f1c40f','#9b59b6','#34495e','#ff8c00','#16a085'];

function nextColor(current){
  const idx = PALETTE.indexOf(current);
  if(idx < 0) return PALETTE[0];
  return PALETTE[(idx+1) % PALETTE.length];
}

function applyColor(entityType, id, newColor){
  if(entityType==='project'){
    const p = state.projects.find(x=>x.id===id); if(!p) return; p.color = newColor; bus.emit('projects:changed', state.projects);
  } else if(entityType==='team'){
    const t = state.teams.find(x=>x.id===id); if(!t) return; t.color = newColor; bus.emit('teams:changed', state.teams);
  }
  bus.emit('color:changed', { entityType, id, color:newColor });
}

function handleClick(e){
  const dot = e.target.closest('.color-dot');
  if(!dot) return;
  const projId = dot.getAttribute('data-color-id');
  // Determine if id belongs to project or team
  if(state.projects.some(p=>p.id===projId)){
    const p = state.projects.find(p=>p.id===projId);
    applyColor('project', projId, nextColor(p.color));
  } else if(state.teams.some(t=>t.id===projId)){
    const tm = state.teams.find(t=>t.id===projId);
    applyColor('team', projId, nextColor(tm.color));
  }
}

export function initColorManager(){
  // Delegate click from sidebar
  const sidebar = document.getElementById('sidebar');
  if(sidebar){ sidebar.addEventListener('click', handleClick); }
}
