import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { StateFilterEvents } from '../core/EventRegistry.js';
// Note: avoid static import of PluginGraph to keep module loading lazy

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
  const group = document.createElement('div'); group.className='chip-group';
  // Determine current selection set
  const selSet = state.selectedStateFilter instanceof Set ? state.selectedStateFilter : new Set(state.selectedStateFilter || []);
  // All/None chip: label toggles between 'All' (when some are deselected) and 'None' when all are selected
  const allSelected = selSet.size === (state.availableStates || []).length && (state.availableStates || []).length > 0;
  const anyDeselected = selSet.size < (state.availableStates || []).length;
  const allLabel = allSelected ? 'None' : 'All';
  const allChip = makeChip(allLabel, { active: allSelected, onClick: ()=> { state.setAllStatesSelected(!allSelected); }, ariaPressed: allSelected });
  group.appendChild(allChip);
  (state.availableStates || []).forEach(s => {
    const active = selSet.has(s);
    const chip = makeChip(s, { active, onClick: ()=> state.toggleStateSelected(s), ariaPressed: active });
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
  // Capacity selector + Open Graph action (moved here)
  const capWrapper = document.createElement('div');
  const capTitle = document.createElement('div'); capTitle.className = 'group-label'; capTitle.textContent = 'Capacity:';
  const capGroup = document.createElement('div'); capGroup.className = 'chip-group'; capGroup.setAttribute('role','radiogroup');
  const teamChip = makeChip('Team', { active: state.capacityViewMode==='team', onClick: ()=> state.setcapacityViewMode('team'), role:'radio', ariaChecked: state.capacityViewMode==='team' });
  const projectChip = makeChip('Project', { active: state.capacityViewMode==='project', onClick: ()=> state.setcapacityViewMode('project'), role:'radio', ariaChecked: state.capacityViewMode==='project' });
  // Open Graph chip shows modal (active if modal present and visible)
  // Prefer Lit component presence (`<plugin-graph>`) for modal state; fallback to legacy placeholder
  const pluginEl = document.querySelector('plugin-graph');
  let modalOpen = false;
  if(pluginEl){ const dsp = pluginEl.style.display; if(dsp && dsp !== 'none') modalOpen = true; else { const cs = window.getComputedStyle(pluginEl); modalOpen = cs.display !== 'none'; } }

  const openGraphChip = makeChip('Open Graph', {
    active: modalOpen,
    onClick: async ()=>{
      try{
        await import('./PluginGraph.lit.js');
        let plugin = document.querySelector('plugin-graph');
        const main = document.querySelector('main');
        if(plugin){
          // if visible -> close
          const dsp = plugin.style.display;
          const visible = (dsp && dsp !== 'none') || (window.getComputedStyle && window.getComputedStyle(plugin).display !== 'none');
          if(visible){ if(typeof plugin.close === 'function') plugin.close(); setTimeout(()=>{ const node = document.getElementById('viewOptionsContainer'); if(node) initViewOptions(node); }, 40); return; }
        }
        // not present or not visible -> create/open
        if(!plugin){ plugin = document.createElement('plugin-graph'); if(main) main.appendChild(plugin); else document.body.appendChild(plugin); }
        const mode = state.capacityViewMode === 'team' ? 'team' : 'project';
        if(plugin.updateComplete) await plugin.updateComplete.catch(()=>{});
        if(typeof plugin.open === 'function') plugin.open(mode);
      }catch(err){ console.warn('Failed to toggle plugin-graph', err); }
      setTimeout(()=>{ const node = document.getElementById('viewOptionsContainer'); if(node) initViewOptions(node); }, 50);
    },
    role: 'radio',
    ariaChecked: modalOpen
  });
  capGroup.appendChild(teamChip); capGroup.appendChild(projectChip); capGroup.appendChild(openGraphChip);
  capWrapper.appendChild(capTitle); capWrapper.appendChild(capGroup);
  root.appendChild(capWrapper);
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

