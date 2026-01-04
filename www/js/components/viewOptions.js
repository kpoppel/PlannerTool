import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { StateFilterEvents } from '../core/EventRegistry.js';
import { featureFlags } from '../config.js';

function makeChip(label, { active=false, onClick, ariaPressed=false, role=null, ariaChecked=null, color=null }){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.textContent = label;
  if(color){ btn.style.setProperty('--chip-accent', color); btn.classList.add('chip-with-accent'); }
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
  const group = document.createElement('div'); group.className='chip-group';
  // Determine current selection set
  const selSet = state.selectedFeatureStateFilter instanceof Set ? state.selectedFeatureStateFilter : new Set(state.selectedFeatureStateFilter || []);
  // All/None chip: label toggles between 'All' (when some are deselected) and 'None' when all are selected
  const availableStates = state._stateFilterService.availableFeatureStates;
  const allSelected = selSet.size === availableStates.length && availableStates.length > 0;
  const anyDeselected = selSet.size < availableStates.length;
  const allLabel = allSelected ? 'None' : 'All';
  const allChip = makeChip(allLabel, { 
    active: allSelected, 
    onClick: ()=> state._stateFilterService.setAllStatesSelected(!allSelected), 
    ariaPressed: allSelected 
  });
  group.appendChild(allChip);
  availableStates.forEach(s => {
    const active = selSet.has(s);
    const chip = makeChip(s, { 
      active, 
      onClick: ()=> state._stateFilterService.toggleStateSelected(s), 
      ariaPressed: active, 
      color: state._colorService.getFeatureStateColor(s) 
    });
    group.appendChild(chip);
  });
  wrapper.appendChild(title); wrapper.appendChild(group);
  container.appendChild(wrapper);
}

export function initViewOptions(container){
  const root = container || document.getElementById('viewOptionsContainer');
  if(!root) return;
  root.innerHTML = '';
  // Condensed cards - use ViewService directly
  renderToggle(root, 'Condensed', 
    ()=> state._viewService.condensedCards, 
    (val)=> state._viewService.setCondensedCards(val)
  );
  // Dependencies - use ViewService directly
  renderToggle(root, 'Dependencies', 
    ()=> state._viewService.showDependencies, 
    (val)=> state._viewService.setShowDependencies(val)
  );
  // Show Unassigned Cards - use ViewService directly
  renderToggle(root, 'Show Unassigned', 
    ()=> state._viewService.showUnassignedCards, 
    (val)=> state._viewService.setShowUnassignedCards(val)
  );
  // Show Unplanned Work - only when feature flag is enabled
  if (featureFlags.SHOW_UNPLANNED_WORK) {
    renderToggle(root, 'Show Unplanned', 
      ()=> state._viewService.showUnplannedWork, 
      (val)=> state._viewService.setShowUnplannedWork(val)
    );
  }
  // Capacity selector + Open Graph action (moved here)
  const capWrapper = document.createElement('div');
  const capTitle = document.createElement('div'); capTitle.className = 'group-label'; capTitle.textContent = 'Capacity:';
  const capGroup = document.createElement('div'); capGroup.className = 'chip-group'; capGroup.setAttribute('role','radiogroup');
  const teamChip = makeChip('Team', { 
    active: state._viewService.capacityViewMode==='team', 
    onClick: ()=> state._viewService.setCapacityViewMode('team'), 
    role:'radio', 
    ariaChecked: state._viewService.capacityViewMode==='team' 
  });
  const projectChip = makeChip('Project', { 
    active: state._viewService.capacityViewMode==='project', 
    onClick: ()=> state._viewService.setCapacityViewMode('project'), 
    role:'radio', 
    ariaChecked: state._viewService.capacityViewMode==='project' 
  });
  capGroup.appendChild(teamChip); capGroup.appendChild(projectChip);
  capWrapper.appendChild(capTitle); capWrapper.appendChild(capGroup);
  root.appendChild(capWrapper);
  // Sort mode - use ViewService directly
  renderRadioGroup(root, 'Sort', [
    { label:'Rank', active: state._viewService.featureSortMode==='rank', onClick: ()=> state._viewService.setFeatureSortMode('rank') },
    { label:'Date', active: state._viewService.featureSortMode==='date', onClick: ()=> state._viewService.setFeatureSortMode('date') },
  ]);
  // Task types - use ViewService directly
  renderMultiSelect(root, 'Task Types', [
    { label:'Epics', active: state._viewService.showEpics, onClick: ()=> state._viewService.setShowEpics(!state._viewService.showEpics) },
    { label:'Features', active: state._viewService.showFeatures, onClick: ()=> state._viewService.setShowFeatures(!state._viewService.showFeatures) },
  ]);
  // State filter
  renderStateFilter(root);
}
function reinit(){
  const node = document.getElementById('viewOptionsContainer');
  if(!node) return;
  initViewOptions(node);
}

// Register the states:changed listener only once at module level
bus.on(StateFilterEvents.CHANGED, ()=>{
  const node = document.getElementById('viewOptionsContainer');
  if(!node) return;
  // Rebuild only the state filter portion: simplest is full re-init to sync active flags
  initViewOptions(node);
});

