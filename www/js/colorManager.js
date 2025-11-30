import { state } from './state.js';
import { bus } from './eventBus.js';
import { saveProjectColor, saveTeamColor } from './dataLocalStorageService.js';

// Expanded 16-color palette
export const PALETTE = [
  '#3498db','#2980b9','#1abc9c','#16a085',
  '#27ae60','#2ecc71','#f1c40f','#f39c12',
  '#e67e22','#d35400','#e74c3c','#c0392b',
  '#9b59b6','#8e44ad','#34495e','#7f8c8d'
];

let popoverEl = null;
let currentTargetId = null;
let currentEntityType = null;

function applyColor(entityType, id, newColor){
  if(entityType==='project'){
    const p = state.projects.find(x=>x.id===id); if(!p) return; p.color = newColor; saveProjectColor(id, newColor); bus.emit('projects:changed', state.projects);
  } else if(entityType==='team'){
    const t = state.teams.find(x=>x.id===id); if(!t) return; t.color = newColor; saveTeamColor(id, newColor); bus.emit('teams:changed', state.teams);
  }
  bus.emit('color:changed', { entityType, id, color:newColor });
}

function closePopover(){
  if(popoverEl){ popoverEl.style.display='none'; }
  currentTargetId = null; currentEntityType = null;
  document.removeEventListener('mousedown', outsideListener);
  document.removeEventListener('keydown', escListener);
}

function outsideListener(e){
  if(!popoverEl) return;
  if(popoverEl.contains(e.target)) return;
  if(e.target.classList.contains('color-dot')) return; // allow re-open
  closePopover();
}
function escListener(e){ if(e.key==='Escape') closePopover(); }

function ensurePopover(){
  if(popoverEl) return popoverEl;
  popoverEl = document.createElement('div');
  popoverEl.className='color-popover';
  PALETTE.forEach(color => {
    const sw = document.createElement('button');
    sw.type='button';
    sw.className='color-swatch';
    sw.style.background=color;
    sw.setAttribute('data-color', color);
    sw.addEventListener('click', () => {
      if(currentTargetId && currentEntityType){
        applyColor(currentEntityType, currentTargetId, color);
      }
      closePopover();
    });
    popoverEl.appendChild(sw);
  });
  document.body.appendChild(popoverEl);
  return popoverEl;
}

function openPopover(dot){
  const id = dot.getAttribute('data-color-id');
  if(state.projects.some(p=>p.id===id)){
    currentEntityType='project';
  } else if(state.teams.some(t=>t.id===id)){
    currentEntityType='team';
  } else {
    return; // unknown entity
  }
  currentTargetId = id;
  const el = ensurePopover();
  const rect = dot.getBoundingClientRect();
  el.style.display='grid';
  el.style.left = (window.scrollX + rect.left) + 'px';
  el.style.top = (window.scrollY + rect.bottom + 4) + 'px';
  document.addEventListener('mousedown', outsideListener);
  document.addEventListener('keydown', escListener);
}

function handleSidebarClick(e){
  const dot = e.target.closest('.color-dot');
  if(!dot) return;
  // Toggle popover if same target
  if(popoverEl && popoverEl.style.display==='grid' && currentTargetId === dot.getAttribute('data-color-id')){
    closePopover();
    return;
  }
  openPopover(dot);
}

export function initColorManager(){
  const sidebar = document.getElementById('sidebar');
  if(sidebar){ sidebar.addEventListener('click', handleSidebarClick); }
}
