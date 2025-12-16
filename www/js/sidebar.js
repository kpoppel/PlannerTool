import { state } from './state.js';
import { dataService } from './dataService.js';
import { openConfigModal, openInputModal, openConfirmModal, openHelpModal } from './modal.js';
import { bus } from './eventBus.js';
import { initViewOptions } from './viewOptions.js';

const elCache = {};

export function initSidebar(){

  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <h2>Planner Tool</h2>
    <section class="sidebar-section" id="viewOptionsSection">
      <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▲</span><span class="sidebar-title">View Options</span></div>
      <div class="sidebar-section-collapsed"> <!-- collapsible wrapper -->
        <div id="viewOptionsContainer"></div>
      </div>
    </section>
    <section class="sidebar-section" id="projectsSection">
      <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Projects</span></div>
      <div class=""> <!-- collapsible wrapper -->
        <div class="counts-header" aria-hidden="true">
          <span></span>
          <span id="projectToggleBtn" class="list-toggle-btn" role="button" tabindex="0" title="Select all / Clear all projects"><svg class="checkbox-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 149.15041 149.14843" width="16" height="16" aria-hidden="true"><path fill="#5481E6" d="m5 0c-2.77 0-5 2.23-5 5v139.15c0 2.77 2.23 5 5 5h139.15c2.77 0 5-2.23 5-5v-139.15c0-2.77-2.23-5-5-5h-139.15zm10.734 10.732h117.68c2.77 0 5 2.23 5 5v117.68c0 2.77-2.23 5-5 5h-117.68c-2.77 0-5.002-2.23-5.002-5v-117.68c0-2.77 2.232-5 5.002-5zm8.332 8.334c-2.77 0-5 2.23-5 5v101.02c0 2.77 2.23 5 5 5h101.02c2.77 0 5-2.23 5-5v-101.02c0-2.77-2.23-5-5-5h-101.02zm92.346 7.5195c1.875 0 3.1348 0.17577 3.7793 0.52734 0.64453 0.35156 0.9668 0.79101 0.9668 1.3184 0 0.82031-0.9668 2.4316-2.9004 4.834-22.617 27.188-43.594 55.898-62.93 86.133-1.3477 2.1094-4.1016 3.1641-8.2617 3.1641-4.2188 0-6.709-0.1758-7.4707-0.5274-1.9922-0.8789-4.336-5.3613-7.0312-13.447-3.0469-8.9649-4.5703-14.59-4.5703-16.875 0-2.4609 2.0508-4.834 6.1524-7.1191 2.5195-1.4062 4.7461-2.1094 6.6797-2.1094 2.2852 0 4.0137 1.875 5.1855 5.625 2.3438 7.0312 4.0137 10.547 5.0098 10.547 0.76172 0 1.5527-0.5859 2.373-1.7578 16.465-26.367 31.699-47.695 45.703-63.984 3.6328-4.2188 9.4043-6.3281 17.314-6.3281z"/></svg></span>
          <span></span>
          <span class="type-icon epic" title="Epics">👑</span>
          <span class="type-icon feature" title="Features"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M7 3h10v3c0 2.761-2.239 5-5 5s-5-2.239-5-5V3zm5 10c3.314 0 6-2.686 6-6V2H6v5c0 3.314 2.686 6 6 6zm-3.5 2h7a.5.5 0 01.5.5c0 .828-.672 1.5-1.5 1.5h-5a1.5 1.5 0 01-1.5-1.5.5.5 0 01.5-.5zm-1.75 4h11.5c.276 0 .5.224.5.5v1c0 .276-.224.5-.5.5H6.75a.5.5 0 01-.5-.5v-1c0-.276.224-.5.5-.5z"/></svg></span>
        </div>
        <ul class="sidebar-list" id="projectList"></ul>
      </div>
    </section>
    <section class="sidebar-section" id="teamsSection">
      <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Teams</span></div>
      <div class=""> <!-- collapsible wrapper -->
        <div class="counts-header" aria-hidden="true">
          <span></span>
          <span id="teamToggleBtn" class="list-toggle-btn" role="button" tabindex="0" title="Select all / Clear all teams"><svg class="checkbox-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 149.15041 149.14843" width="16" height="16" aria-hidden="true"><path fill="#5481E6" d="m5 0c-2.77 0-5 2.23-5 5v139.15c0 2.77 2.23 5 5 5h139.15c2.77 0 5-2.23 5-5v-139.15c0-2.77-2.23-5-5-5h-139.15zm10.734 10.732h117.68c2.77 0 5 2.23 5 5v117.68c0 2.77-2.23 5-5 5h-117.68c-2.77 0-5.002-2.23-5.002-5v-117.68c0-2.77 2.232-5 5.002-5zm8.332 8.334c-2.77 0-5 2.23-5 5v101.02c0 2.77 2.23 5 5 5h101.02c2.77 0 5-2.23 5-5v-101.02c0-2.77-2.23-5-5-5h-101.02zm92.346 7.5195c1.875 0 3.1348 0.17577 3.7793 0.52734 0.64453 0.35156 0.9668 0.79101 0.9668 1.3184 0 0.82031-0.9668 2.4316-2.9004 4.834-22.617 27.188-43.594 55.898-62.93 86.133-1.3477 2.1094-4.1016 3.1641-8.2617 3.1641-4.2188 0-6.709-0.1758-7.4707-0.5274-1.9922-0.8789-4.336-5.3613-7.0312-13.447-3.0469-8.9649-4.5703-14.59-4.5703-16.875 0-2.4609 2.0508-4.834 6.1524-7.1191 2.5195-1.4062 4.7461-2.1094 6.6797-2.1094 2.2852 0 4.0137 1.875 5.1855 5.625 2.3438 7.0312 4.0137 10.547 5.0098 10.547 0.76172 0 1.5527-0.5859 2.373-1.7578 16.465-26.367 31.699-47.695 45.703-63.984 3.6328-4.2188 9.4043-6.3281 17.314-6.3281z"/></svg></span>
          <span></span>
          <span class="type-icon epic" title="Epics">👑</span>
          <span class="type-icon feature" title="Features"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M7 3h10v3c0 2.761-2.239 5-5 5s-5-2.239-5-5V3zm5 10c3.314 0 6-2.686 6-6V2H6v5c0 3.314 2.686 6 6 6zm-3.5 2h7a.5.5 0 01.5.5c0 .828-.672 1.5-1.5 1.5h-5a1.5 1.5 0 01-1.5-1.5.5.5 0 01.5-.5zm-1.75 4h11.5c.276 0 .5.224.5.5v1c0 .276-.224.5-.5.5H6.75a.5.5 0 01-.5-.5v-1c0-.276.224-.5.5-.5z"/></svg></span>
        </div>
        <ul class="sidebar-list" id="teamList"></ul>
      </div>
    </section>
    <section class="sidebar-section" id="scaleSection" style="display:none">
      <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Timeline Scale</span></div>
      <div class=""> <!-- collapsible wrapper -->
        <div class="filter-group">
          <label><input type="radio" name="scale" value="months" checked> Months</label>
          <label><input type="radio" name="scale" value="weeks"> Weeks</label>
          <label><input type="radio" name="scale" value="years"> Years</label>
        </div>
      </div>
    </section>
    <section class="sidebar-section" id="scenariosSection">
      <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Scenarios</span></div>
      <div class=""> <!-- collapsible wrapper -->
        <ul class="sidebar-list" id="scenarioList"></ul>
      </div>
    </section>
    <section class="sidebar-config" id="configSection">
      <div class="sidebar-section-header"><span class="sidebar-title">Configuration & Help</span></div>
      <div class="config-row">
        <button id="openConfigBtn" title="Configuration">⚙️ Configuration</button>
        <button id="openHelpBtn" title="Help">❓ Help</button>
      </div>
      <div id='serverStatusLabel' style='font-size:12px; margin-top:8px;'>Server: loading...</div>
      <div id='attributionLabel' style='font-size:9px; margin-top:8px;'>(c) 2025 Kim Poulsen</div>
    </section>`;

  // Collapse/expand logic for sidebar sections
  // TODO: Start View Options not expanded. Probably the best thing to do is to wrap the content
  //       of the expandable in a div and set the display style on that either directly of using a class "collapsed".
  const sectionHeaders = sidebar.querySelectorAll('.sidebar-section-header-collapsible');
  sectionHeaders.forEach(header => {
    const chevron = header.querySelector('.sidebar-chevron');
    const section = header.parentElement;
    const contentWrapper = section.children[1];
    // Handler after initial load
    function toggleSection() {
      if (contentWrapper.classList.contains('sidebar-section-collapsed')) {
        contentWrapper.classList.remove('sidebar-section-collapsed');
        chevron.textContent = '▼';
      } else {
        contentWrapper.classList.add('sidebar-section-collapsed');
        chevron.textContent = '▲';
      }
    }
    header.addEventListener('click', toggleSection);
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSection();
    });
  });

  // Cache elements
  elCache.projectList = document.getElementById('projectList');
  elCache.teamList = document.getElementById('teamList');
  elCache.scenarioList = document.getElementById('scenarioList');
  renderProjects();
  renderTeams();
  renderScenarios();
  // Wire list toggle buttons
  const projectToggleBtn = document.getElementById('projectToggleBtn');
  const teamToggleBtn = document.getElementById('teamToggleBtn');
  function setAllInList(listEl, checked){
    if(!listEl) return;
    const inputs = Array.from(listEl.querySelectorAll('input[type="checkbox"]'));
    inputs.forEach(i=>{
      i.checked = checked;
      // Update application state directly to ensure persistence
      if(i.hasAttribute('data-project')){
        const pid = i.getAttribute('data-project');
        state.setProjectSelected(pid, checked);
      }
      if(i.hasAttribute('data-team')){
        const tid = i.getAttribute('data-team');
        state.setTeamSelected(tid, checked);
      }
      // Also emit a composed, bubbling change event so any listeners react
      i.dispatchEvent(new Event('change', { bubbles: true, composed: true, cancelable: true }));
    });
  }
  if(projectToggleBtn){
    const handleProjectToggle = ()=>{
      const list = document.getElementById('projectList');
      if(!list) return;
      const inputs = Array.from(list.querySelectorAll('input[type="checkbox"]'));
      const anyUnchecked = inputs.some(i=>!i.checked);
      setAllInList(list, anyUnchecked);
      projectToggleBtn.classList.add('toggle-pulse'); setTimeout(()=> projectToggleBtn.classList.remove('toggle-pulse'),700);
    };
    projectToggleBtn.addEventListener('click', handleProjectToggle);
  }
  if(teamToggleBtn){
    const handleTeamToggle = ()=>{
      const list = document.getElementById('teamList');
      if(!list) return;
      const inputs = Array.from(list.querySelectorAll('input[type="checkbox"]'));
      const anyUnchecked = inputs.some(i=>!i.checked);
      setAllInList(list, anyUnchecked);
      teamToggleBtn.classList.add('toggle-pulse'); setTimeout(()=> teamToggleBtn.classList.remove('toggle-pulse'),700);
    };
    teamToggleBtn.addEventListener('click', handleTeamToggle);
  }
  sidebar.addEventListener('change', onSidebarChange);
  bus.on('projects:changed', renderProjects);
  bus.on('teams:changed', renderTeams);
  bus.on('scenario:list', renderScenarios);
  bus.on('scenario:activated', renderScenarios);
  bus.on('scenario:updated', renderScenarios);
  // Ensure scenarios render when full data is preloaded
  bus.on('scenarios:data', renderScenarios);

  const openConfigBtn = document.getElementById('openConfigBtn');
  if (openConfigBtn) {
    openConfigBtn.addEventListener('click', () => {
      openConfigModal();
    });
  }

  const openHelpBtn = document.getElementById('openHelpBtn');
  if (openHelpBtn) {
    openHelpBtn.addEventListener('click', () => {
      openHelpModal();
    });
  }

  // Initialize chip-based View Options UI
  const viewOptionsHost = document.getElementById('viewOptionsContainer');
  if(viewOptionsHost){
    initViewOptions(viewOptionsHost);
  }

  // Fetch health once on init (no periodic polling)
  refreshServerStatus();
}

function renderProjects(){
  elCache.projectList.innerHTML = '';
  state.projects.forEach(p=>{
    // Count epics and features for this project (baseline only)
    const epicsCount = state.baselineFeatures.filter(f => f.project === p.id && f.type === 'epic').length;
    const featuresCount = state.baselineFeatures.filter(f => f.project === p.id && f.type === 'feature').length;
      const li = document.createElement('li');
      li.className='sidebar-list-item';
      const wrapper = document.createElement('div'); wrapper.className = 'chip sidebar-chip'; wrapper.style.display = 'flex'; wrapper.style.alignItems = 'stretch'; wrapper.style.gap = '8px'; wrapper.style.width = '100%';
      const color = document.createElement('span'); color.className = 'color-dot'; color.style.background = p.color; color.setAttribute('data-color-id', p.id); color.setAttribute('aria-hidden','true');
      const labelWrap = document.createElement('div'); labelWrap.style.display='flex'; labelWrap.style.alignItems='center'; labelWrap.style.gap='8px'; labelWrap.style.flex='1';
      const title = document.createElement('div'); title.className='project-name-col'; title.textContent = p.name; title.title = p.name; title.style.alignSelf = 'center';
      const badges = document.createElement('div'); badges.style.display='inline-flex'; badges.style.gap='6px'; badges.style.marginLeft = 'auto'; badges.style.alignItems = 'center';
      const epBadge = document.createElement('span'); epBadge.className='chip-badge'; epBadge.textContent = String(epicsCount);
      const featBadge = document.createElement('span'); featBadge.className='chip-badge'; featBadge.textContent = String(featuresCount);
      badges.appendChild(epBadge); badges.appendChild(featBadge);
      labelWrap.appendChild(title);
    // Hidden checkbox for accessibility; keep data attribute for toggling
    const chk = document.createElement('input'); chk.type='checkbox'; chk.style.display='none'; chk.setAttribute('data-project', p.id); if(p.selected) chk.checked = true;
    wrapper.appendChild(color); wrapper.appendChild(labelWrap); wrapper.appendChild(badges); wrapper.appendChild(chk);
    // Hover effect: show pressed state on hover similar to chips
    wrapper.addEventListener('mouseenter', ()=> wrapper.classList.add('chip-hover'));
    wrapper.addEventListener('mouseleave', ()=> wrapper.classList.remove('chip-hover'));
    wrapper.addEventListener('click', (e)=>{
      // If click originated on color-dot let color manager handle it
      if(e.target.closest('.color-dot')) return;
      const newVal = !chk.checked;
      chk.checked = newVal;
      state.setProjectSelected(p.id, newVal);
      // emit change for other listeners
      chk.dispatchEvent(new Event('change', { bubbles:true }));
      // update visual active state
      if(newVal) wrapper.classList.add('active'); else wrapper.classList.remove('active');
    });
    if(p.selected) wrapper.classList.add('active');
    li.appendChild(wrapper);
    elCache.projectList.appendChild(li);
  });
}

function renderTeams(){
  elCache.teamList.innerHTML = '';
  state.teams.forEach(t=>{
    const li = document.createElement('li');
    li.className='sidebar-list-item';
    const epicsCount = state.baselineFeatures.filter(f => f.type==='epic' && f.capacity.some(tl=>tl.team===t.id)).length;
    const featuresCount = state.baselineFeatures.filter(f => f.type==='feature' && f.capacity.some(tl=>tl.team===t.id)).length;
    const wrapper = document.createElement('div'); wrapper.className = 'chip sidebar-chip'; wrapper.style.display = 'flex'; wrapper.style.alignItems = 'stretch'; wrapper.style.gap = '8px'; wrapper.style.width = '100%';
    const color = document.createElement('span'); color.className = 'color-dot'; color.style.background = t.color; color.setAttribute('data-color-id', t.id); color.setAttribute('aria-hidden','true');
    const labelWrap = document.createElement('div'); labelWrap.style.display='flex'; labelWrap.style.alignItems='center'; labelWrap.style.gap='8px'; labelWrap.style.flex='1';
    const title = document.createElement('div'); title.className='team-name-col'; title.textContent = t.name + (t.short? ' ('+t.short+')':''); title.title = t.name; title.style.alignSelf='center';
    const badges = document.createElement('div'); badges.style.display='inline-flex'; badges.style.gap='6px'; badges.style.marginLeft='auto'; badges.style.alignItems='center';
    const epBadge = document.createElement('span'); epBadge.className='chip-badge'; epBadge.textContent = String(epicsCount);
    const featBadge = document.createElement('span'); featBadge.className='chip-badge'; featBadge.textContent = String(featuresCount);
    badges.appendChild(epBadge); badges.appendChild(featBadge);
    labelWrap.appendChild(title);
    const chk = document.createElement('input'); chk.type='checkbox'; chk.style.display='none'; chk.setAttribute('data-team', t.id); if(t.selected) chk.checked = true;
    wrapper.appendChild(color); wrapper.appendChild(labelWrap); wrapper.appendChild(badges); wrapper.appendChild(chk);
      wrapper.addEventListener('mouseenter', ()=> wrapper.classList.add('chip-hover'));
      wrapper.addEventListener('mouseleave', ()=> wrapper.classList.remove('chip-hover'));
      wrapper.addEventListener('click', (e)=>{
        // If click originated on color-dot let color manager handle it
        if(e.target.closest('.color-dot')) return;
        const newVal = !chk.checked;
        chk.checked = newVal;
        state.setTeamSelected(t.id, newVal);
        chk.dispatchEvent(new Event('change', { bubbles:true }));
        if(newVal) wrapper.classList.add('active'); else wrapper.classList.remove('active');
      });
    if(t.selected) wrapper.classList.add('active');
    li.appendChild(wrapper);
    elCache.teamList.appendChild(li);
  });
}

function closeAnyScenarioMenu(){
  document.querySelectorAll('.scenario-menu-popover').forEach(p=>p.remove());
}

function renderScenarios(){
  if(!elCache.scenarioList) return;
  elCache.scenarioList.innerHTML = '';
  // Ensure baseline is shown first, then other scenarios (by name)
  const sorted = [...state.scenarios].sort((a,b)=>{
    if(a.id==='baseline' && b.id!=='baseline') return -1;
    if(b.id==='baseline' && a.id!=='baseline') return 1;
    const an = (a.name||'').toLowerCase();
    const bn = (b.name||'').toLowerCase();
    return an.localeCompare(bn);
  });
  sorted.forEach(s => {
    const li = document.createElement('li');
    li.className = 'sidebar-list-item scenario-item sidebar-chip';
    if(s.id === state.activeScenarioId) li.classList.add('active');
    const controls = document.createElement('span'); controls.className='scenario-controls';
    // Name label
    const nameSpan = document.createElement('span'); nameSpan.className='scenario-name'; nameSpan.textContent = s.name; nameSpan.title = s.name;
    // Make the whole row activate the scenario when clicked, except when clicking on the controls
    li.addEventListener('click', (e) => {
      if (e.target.closest('.scenario-controls')) return; // allow controls to handle their clicks
      state.activateScenario(s.id);
    });
    // Show warning icon if scenario is unsaved.
    if (state.isScenarioUnsaved(s)) {
      const warn = document.createElement('span'); warn.className='scenario-warning'; warn.title = s.id==='baseline' ? 'Baseline modified (overrides present)' : 'Scenario has unsaved changes'; warn.textContent='⚠️'; li.appendChild(warn);
    }
    li.appendChild(nameSpan);
    const defaultCloneName = (()=>{
      // Use naming pattern from state: MM-DD Scenario N
      const now = new Date();
      const mm = String(now.getMonth()+1).padStart(2,'0');
      const dd = String(now.getDate()).padStart(2,'0');
      // Find largest N among existing scenario names
      let maxN=0; const re=/^\d{2}-\d{2} Scenario (\d+)$/i;
      state.scenarios.forEach(sc=>{ const m=re.exec(sc.name); if(m){ const n=parseInt(m[1],10); if(n>maxN) maxN=n; } });
      return `${mm}-${dd} Scenario ${maxN+1}`;
    })();
    // Unified menu button
    const menuBtn = document.createElement('button'); menuBtn.type='button'; menuBtn.className='scenario-btn'; menuBtn.title='Scenario actions'; menuBtn.textContent='⋯';
    menuBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      closeAnyScenarioMenu();
      const pop = document.createElement('div'); pop.className='scenario-menu-popover';
      function addItem(label, emoji, onClick, disabled=false){
        const item = document.createElement('div'); item.className='scenario-menu-item';
        if(disabled) item.classList.add('disabled');
        item.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
        if(!disabled) item.addEventListener('click', ev => { ev.stopPropagation(); onClick(); closeAnyScenarioMenu(); });
        pop.appendChild(item);
      }
      // Add Clone Scenario for all scenarios
      addItem('Clone Scenario', '⎘', ()=>{
        openInputModal({ title:`Clone Scenario`, message:`Create a new scenario from "${s.name}".`, label:'Scenario name', defaultValue: defaultCloneName, confirmLabel:'Clone', validate: validateScenarioName, onConfirm: (val)=>{ const newScen = state.cloneScenario(s.id, val); if(newScen){ state.activateScenario(newScen.id); } } });
      });
      if(s.id === 'baseline'){
        addItem('Refresh Baseline', '🔄', async ()=>{
          await state.refreshBaseline();
        });
        // Baseline cannot rename/delete
      } else {
        addItem('Rename', '✏️', ()=>{
          openInputModal({ title:'Rename Scenario', message:'Enter a new unique name for the scenario.', label:'Scenario name', defaultValue: s.name, confirmLabel:'Rename', validate: validateScenarioName, onConfirm:(val)=>{ state.renameScenario(s.id, val); } });
        });
        addItem('Delete', '🗑️', ()=>{
          openConfirmModal({ title:'Delete Scenario', message:`Delete scenario "${s.name}"? This cannot be undone.`, confirmLabel:'Delete', onConfirm:()=>{ state.deleteScenario(s.id); } });
        });
        // Save scenario to backend
        addItem('Save Scenario', '💾', async ()=>{
          await state.saveScenario(s.id);
        });
        addItem('Save to Azure DevOps', '💾', async ()=>{
          const overrides = s.overrides || {};
          const overrideEntries = Object.entries(overrides);
          console.log('Preparing to annotate overrides back to Azure DevOps...', overrideEntries);
          if(overrideEntries.length === 0){ console.log('No differing overrides to annotate.'); return; }
          const { openSaveToAzureModal } = await import('./modal.js');
          const selected = await openSaveToAzureModal(overrides, state);
          if(selected && selected.length){
            await dataService.publishBaseline(selected);
          }
        });
      }
      const rect = menuBtn.getBoundingClientRect();
      pop.style.top = (rect.top + window.scrollY + rect.height + 4) + 'px';
      pop.style.left = (rect.left + window.scrollX - 20) + 'px';
      document.body.appendChild(pop);
      function onDocClick(){ closeAnyScenarioMenu(); document.removeEventListener('click', onDocClick); }
      setTimeout(()=> document.addEventListener('click', onDocClick), 0);
    });
    controls.appendChild(menuBtn);
    li.appendChild(controls);
    elCache.scenarioList.appendChild(li);
  });
}
function onSidebarChange(e){
  if(e.target.matches('input[data-project]')){ state.setProjectSelected(e.target.getAttribute('data-project'), e.target.checked); }
  if(e.target.matches('input[data-team]')){ state.setTeamSelected(e.target.getAttribute('data-team'), e.target.checked); }
  if(e.target.name==='scale'){ state.setTimelineScale(e.target.value); }
  if(e.target.id==='filterEpics'){ state.setShowEpics(e.target.checked); }
  if(e.target.id==='filterFeatures'){ state.setShowFeatures(e.target.checked); }
  if(e.target.id==='showDependencies'){ state.setShowDependencies(e.target.checked); }
  if(e.target.name==='capacityViewMode' && e.target.checked){ state.setcapacityViewMode(e.target.value); }
  if(e.target.name==='featureSortMode' && e.target.checked){ import('./state.js').then(m=> m.state.setFeatureSortMode(e.target.value)); }
}

function validateScenarioName(val){
  if(!val) return 'Name cannot be empty';
  const exists = state.scenarios.some(s => s.name.toLowerCase() === val.toLowerCase());
  if(exists) return 'Name already exists';
  return null;
}

async function refreshServerStatus(){
  const label = document.getElementById('serverStatusLabel');
  if(!label) return;
  try{
    const h = await dataService.checkHealth();
    // Expecting { status, start_time, uptime_seconds }
    const status = h.status || (h.ok ? 'ok' : 'error');
    const start = h.start_time ? (new Date(h.start_time)).toISOString().slice(0,10) : '';
    const uptimeHours = ('uptime_seconds' in h) ? (h.uptime_seconds / 3600) : null;
    const uptimeStr = uptimeHours !== null ? `${uptimeHours.toFixed(1)}h` : '';
    label.textContent = `Server: ${status} ${start} ${uptimeStr}`;
  }catch(err){
    label.textContent = 'Server: error';
  }
}
