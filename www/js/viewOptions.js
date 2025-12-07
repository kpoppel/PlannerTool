import { state } from './state.js';
import { bus } from './eventBus.js';

function makeChip(label, { active=false, onClick, ariaPressed=false, role=null, ariaChecked=null }){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.textContent = label;
  if(active) btn.classList.add('active');
  if(role) btn.setAttribute('role', role);
  if(ariaPressed !== null) btn.setAttribute('aria-pressed', ariaPressed ? 'true' : 'false');
  if(ariaChecked !== null) btn.setAttribute('aria-checked', ariaChecked ? 'true' : 'false');
  btn.addEventListener('click', (e)=>{ e.stopPropagation(); onClick && onClick(); reinit(); });
  btn.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick && onClick(); reinit(); }
  });
  return btn;
}

function renderToggle(container, label, getCurrent, setter){
  const group = document.createElement('div'); group.className='chip-group';
  const current = !!getCurrent();
  const chip = makeChip(label, { active: current, onClick: ()=> setter(!getCurrent()), ariaPressed: current });
  group.appendChild(chip);
  container.appendChild(group);
}

function renderRadioGroup(container, label, options){
  const wrapper = document.createElement('div');
  const title = document.createElement('div'); title.className='group-label'; title.textContent = label;
  const group = document.createElement('div'); group.className='chip-group'; group.setAttribute('role','radiogroup');
  options.forEach(opt => {
    const chip = makeChip(opt.label, { active: !!opt.active, onClick: opt.onClick, role:'radio', ariaChecked: !!opt.active });
    group.appendChild(chip);
  });
  wrapper.appendChild(title); wrapper.appendChild(group);
  container.appendChild(wrapper);
}

function renderMultiSelect(container, label, options){
  const wrapper = document.createElement('div');
  const title = document.createElement('div'); title.className='group-label'; title.textContent = label;
  const group = document.createElement('div'); group.className='chip-group';
  options.forEach(opt => {
    const chip = makeChip(opt.label, { active: !!opt.active, onClick: opt.onClick, ariaPressed: !!opt.active });
    group.appendChild(chip);
  });
  wrapper.appendChild(title); wrapper.appendChild(group);
  container.appendChild(wrapper);
}

function renderStateFilter(container){
  const wrapper = document.createElement('div');
  const title = document.createElement('div'); title.className='group-label'; title.textContent = 'State Filter:';
  const group = document.createElement('div'); group.className='chip-group'; group.setAttribute('role','radiogroup');
  const sel = state.selectedStateFilter;
  const allChip = makeChip('All', { active: !sel, onClick: ()=> state.setStateFilter(null), role:'radio', ariaChecked: !sel });
  group.appendChild(allChip);
  (state.availableStates || []).forEach(s => {
    const active = sel === s;
    const chip = makeChip(s, { active, onClick: ()=> state.setStateFilter(s), role:'radio', ariaChecked: active });
    group.appendChild(chip);
  });
  wrapper.appendChild(title); wrapper.appendChild(group);
  container.appendChild(wrapper);
}

export function initViewOptions(container){
  const root = container || document.getElementById('viewOptionsContainer');
  if(!root) return;
  root.innerHTML = '';
  // Condensed cards
  renderToggle(root, 'Condensed', ()=> state.condensedCards, (val)=> state.setCondensedCards(val));
  // Dependencies
  renderToggle(root, 'Dependencies', ()=> state.showDependencies, (val)=> state.setShowDependencies(val));
  // Load view mode
  renderRadioGroup(root, 'Load View', [
    { label:'Team Load', active: state.loadViewMode==='team', onClick: ()=> state.setLoadViewMode('team') },
    { label:'Project Load', active: state.loadViewMode==='project', onClick: ()=> state.setLoadViewMode('project') },
  ]);
  // Sort mode
  renderRadioGroup(root, 'Sort', [
    { label:'Rank', active: state.featureSortMode==='rank', onClick: ()=> state.setFeatureSortMode('rank') },
    { label:'Date', active: state.featureSortMode==='date', onClick: ()=> state.setFeatureSortMode('date') },
  ]);
  // Task types
  renderMultiSelect(root, 'Task Types', [
    { label:'Epics', active: state.showEpics, onClick: ()=> state.setShowEpics(!state.showEpics) },
    { label:'Features', active: state.showFeatures, onClick: ()=> state.setShowFeatures(!state.showFeatures) },
  ]);
  // State filter
  renderStateFilter(root);

  // Re-render state filter when availableStates change
  bus.on('states:changed', ()=>{
    const node = document.getElementById('viewOptionsContainer');
    if(!node) return;
    // Rebuild only the state filter portion: simplest is full re-init to sync active flags
    initViewOptions(node);
  });
}

function reinit(){
  const node = document.getElementById('viewOptionsContainer');
  if(!node) return;
  initViewOptions(node);
}
