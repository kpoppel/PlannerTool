import { state } from './state.js';
import { dataService } from './dataService.js';
import { openInputModal, openConfirmModal, openHelpModal } from './modal.js';
import { bus } from './eventBus.js';

const elCache = {};

export function initSidebar(){
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <h2>Projects & Teams</h2>
    <section class="sidebar-section" id="projectsSection">
      <h3>Projects</h3>
      <ul class="sidebar-list" id="projectList"></ul>
    </section>
    <section class="sidebar-section" id="teamsSection">
      <h3>Teams</h3>
      <ul class="sidebar-list" id="teamList"></ul>
    </section>
    <section class="sidebar-section" id="scaleSection" style="display:none">
      <h3>Timeline Scale</h3>
      <div class="filter-group">
        <label><input type="radio" name="scale" value="months" checked> Months</label>
        <label><input type="radio" name="scale" value="weeks"> Weeks</label>
        <label><input type="radio" name="scale" value="years"> Years</label>
      </div>
    </section>
    <section class="sidebar-section" id="filtersSection">
      <h3>Task Types</h3>
      <div class="filter-group">
        <label><input type="checkbox" id="filterFeatures" checked> Features</label>
        <label><input type="checkbox" id="filterEpics" checked> Epics</label>
      </div>
    </section>
    <section class="sidebar-section" id="scenariosSection">
      <h3>Scenarios</h3>
      <ul class="sidebar-list" id="scenarioList"></ul>
    </section>
    <section class="sidebar-section" id="viewOptionsSection">
      <h3>View Options</h3>
      <div class="filter-group">
        <label><input type="checkbox" id="condenseCards"> Condense cards</label>
      </div>
      <div class="filter-group">
        <label><input type="checkbox" id="showDependencies"> Show dependencies</label>
      </div>
      <div class="filter-group" id="loadViewModeGroup">
        <label title="Team-based load view"><input type="radio" name="loadViewMode" value="team" checked> Team Load</label>
        <label title="Project-based aggregate load view"><input type="radio" name="loadViewMode" value="project"> Project Load</label>
      </div>
      <div class="filter-group" id="featureSortModeGroup">
        <span class="group-label">Sort tasks by:</span>
        <label title="Sort by earliest start date"><input type="radio" name="featureSortMode" value="date"> Date</label>
        <label title="Original imported order"><input type="radio" name="featureSortMode" value="rank" checked> Rank</label>
      </div>
    </section>
    <section class="sidebar-section sidebar-config" id="configSection">
      <div class="config-row">
        <button id="openConfigBtn" title="Configuration">⚙️ Configuration</button>
        <button id="openHelpBtn" title="Help">❓ Help</button>
      </div>
    </section>`;
  elCache.projectList = document.getElementById('projectList');
  elCache.teamList = document.getElementById('teamList');
  elCache.scenarioList = document.getElementById('scenarioList');
  renderProjects();
  renderTeams();
  renderScenarios();
  sidebar.addEventListener('change', onSidebarChange);
  bus.on('projects:changed', renderProjects);
  bus.on('teams:changed', renderTeams);
  bus.on('scenario:list', renderScenarios);
  bus.on('scenario:activated', renderScenarios);
  bus.on('scenario:updated', renderScenarios);

  const openConfigBtn = document.getElementById('openConfigBtn');
  if (openConfigBtn) {
    openConfigBtn.addEventListener('click', () => {
      bus.emit('config:open');
    });
  }

  const openHelpBtn = document.getElementById('openHelpBtn');
  if (openHelpBtn) {
    openHelpBtn.addEventListener('click', () => {
      openHelpModal();
    });
  }

  const condenseToggle = document.getElementById('condenseCards');
  if(condenseToggle){
    condenseToggle.checked = !!state.condensedCards;
    condenseToggle.addEventListener('change', (e)=>{
      state.setCondensedCards(e.target.checked);
    });
  }

  const depsToggle = document.getElementById('showDependencies');
  if(depsToggle){
    depsToggle.checked = !!state.showDependencies;
    depsToggle.addEventListener('change', (e)=>{ state.setShowDependencies(e.target.checked); });
  }

  // Initialize load view mode radios
  const radios = sidebar.querySelectorAll('input[name="loadViewMode"]');
  radios.forEach(r => {
    r.checked = (r.value === state.loadViewMode);
    r.addEventListener('change', (e)=>{
      if(e.target.checked){ state.setLoadViewMode(e.target.value); }
    });
  });

  // Initialize feature sort mode radios
  const sortRadios = sidebar.querySelectorAll('input[name="featureSortMode"]');
  sortRadios.forEach(r => {
    r.checked = (r.value === state.featureSortMode);
  });
}

function renderProjects(){
  elCache.projectList.innerHTML = '';
  state.projects.forEach(p=>{
    // Count epics and features for this project (baseline only)
    const epicsCount = state.baselineFeatures.filter(f => f.project === p.id && f.type === 'epic').length;
    const featuresCount = state.baselineFeatures.filter(f => f.project === p.id && f.type === 'feature').length;
    const li = document.createElement('li');
    li.className='sidebar-list-item';
    li.innerHTML = `<span class="color-dot" style="background:${p.color}" data-color-id="${p.id}"></span>
      <label><input type="checkbox" data-project="${p.id}" ${p.selected?'checked':''}/> ${p.name}
        <span class="project-counts">
          <span class="type-icon epic" title="Epics">👑</span><span class="count-badge">${epicsCount}</span>
          <span class="type-icon feature" title="Features"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M7 3h10v3c0 2.761-2.239 5-5 5s-5-2.239-5-5V3zm5 10c3.314 0 6-2.686 6-6V2H6v5c0 3.314 2.686 6 6 6zm-3.5 2h7a.5.5 0 01.5.5c0 .828-.672 1.5-1.5 1.5h-5a1.5 1.5 0 01-1.5-1.5.5.5 0 01.5-.5zm-1.75 4h11.5c.276 0 .5.224.5.5v1c0 .276-.224.5-.5.5H6.75a.5.5 0 01-.5-.5v-1c0-.276.224-.5.5-.5z"/></svg></span><span class="count-badge">${featuresCount}</span>
        </span>
      </label>`;
    elCache.projectList.appendChild(li);
  });
}

function renderTeams(){
  elCache.teamList.innerHTML = '';
  state.teams.forEach(t=>{
    const li = document.createElement('li');
    li.className='sidebar-list-item';
    const epicsCount = state.baselineFeatures.filter(f => f.type==='epic' && f.teamLoads.some(tl=>tl.team===t.id)).length;
    const featuresCount = state.baselineFeatures.filter(f => f.type==='feature' && f.teamLoads.some(tl=>tl.team===t.id)).length;
    li.innerHTML = `<span class="color-dot" style="background:${t.color}" data-color-id="${t.id}"></span>
      <label><input type="checkbox" data-team="${t.id}" ${t.selected?'checked':''}/> ${t.name}
        <span class="project-counts">
          <span class="type-icon epic" title="Epics">👑</span><span class="count-badge">${epicsCount}</span>
          <span class="type-icon feature" title="Features"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M7 3h10v3c0 2.761-2.239 5-5 5s-5-2.239-5-5V3zm5 10c3.314 0 6-2.686 6-6V2H6v5c0 3.314 2.686 6 6 6zm-3.5 2h7a.5.5 0 01.5.5c0 .828-.672 1.5-1.5 1.5h-5a1.5 1.5 0 01-1.5-1.5.5.5 0 01.5-.5zm-1.75 4h11.5c.276 0 .5.224.5.5v1c0 .276-.224.5-.5.5H6.75a.5.5 0 01-.5-.5v-1c0-.276.224-.5.5-.5z"/></svg></span><span class="count-badge">${featuresCount}</span>
        </span>
      </label>`;
    elCache.teamList.appendChild(li);
  });
}

function closeAnyScenarioMenu(){
  document.querySelectorAll('.scenario-menu-popover').forEach(p=>p.remove());
}

function renderScenarios(){
  if(!elCache.scenarioList) return;
  elCache.scenarioList.innerHTML = '';
  state.scenarios.forEach(s => {
    const li = document.createElement('li');
    li.className = 'sidebar-list-item scenario-item';
    if(s.id === state.activeScenarioId) li.classList.add('active');
    const controls = document.createElement('span'); controls.className='scenario-controls';
    // Name label clickable to activate
    const nameSpan = document.createElement('span'); nameSpan.className='scenario-name'; nameSpan.textContent = s.name; nameSpan.title = s.name;
    nameSpan.addEventListener('click', ()=>{ state.activateScenario(s.id); });
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
          // Overrides is a dictionary: { featureId: { start, end, ... } }
          const overrides = s.overrides || {};
          const overrideEntries = Object.entries(overrides);
          console.log('Preparing to annotate overrides back to Azure DevOps...', overrideEntries);
          // TODO: Grey out the save button if there's nothing to save.
          if(overrideEntries.length === 0){ console.log('No differing overrides to annotate.'); return; }
          const overlay = document.createElement('div'); overlay.className='modal-overlay';
          const modal = document.createElement('div'); modal.className='modal wide-modal';
          const titleEl = document.createElement('h3'); titleEl.textContent='Save to Azure DevOps'; modal.appendChild(titleEl);
          const desc = document.createElement('p'); desc.textContent='Select which items to annotate back to Azure DevOps:'; modal.appendChild(desc);
          // Toggle all/none convenience button
          const toggleRow = document.createElement('div'); toggleRow.style.display='flex'; toggleRow.style.justifyContent='flex-end'; toggleRow.style.marginBottom='8px';
          const toggleBtn = document.createElement('button'); toggleBtn.type='button'; toggleBtn.textContent='Toggle All/None'; toggleBtn.title='Toggle select all or none'; toggleBtn.style.marginLeft='8px';
          toggleRow.appendChild(toggleBtn);
          modal.appendChild(toggleRow);
          const table = document.createElement('table'); table.className='scenario-annotate-table';
          const thead = document.createElement('thead'); thead.innerHTML = '<tr><th style="width:64px">Select</th><th>Title</th><th>Start</th><th>End</th></tr>'; table.appendChild(thead);
          const tbody = document.createElement('tbody');
          overrideEntries.forEach(([id, ov]) => {
            console.log('Override to annotate:', id, ov);
            console.log('Feature title:', state.getFeatureTitleById(id));
            const tr = document.createElement('tr');
            const tdSel = document.createElement('td'); const chk = document.createElement('input'); chk.type='checkbox'; chk.checked=true; chk.dataset.id=id; tdSel.appendChild(chk); tr.appendChild(tdSel);
            const tdTitle = document.createElement('td'); tdTitle.textContent = state.getFeatureTitleById(id); tr.appendChild(tdTitle);
            // Show original -> new format for dates
            const baseFeature = state.baselineFeatures.find(f => f.id === id) || {};
            const origStart = baseFeature.start || '';
            const origEnd = baseFeature.end || '';
            const formatRange = (from, to) => {
              if(!from && !to) return '';
              if(!from) return to;
              if(!to) return from;
              if(from === to) return from;
              return `${from} -> ${to}`;
            };
            const tdStart = document.createElement('td'); tdStart.textContent = formatRange(origStart, ov.start); tr.appendChild(tdStart);
            const tdEnd = document.createElement('td'); tdEnd.textContent = formatRange(origEnd, ov.end); tr.appendChild(tdEnd);
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          modal.appendChild(table);
          const buttons = document.createElement('div'); buttons.className='modal-buttons';
          const cancelBtn = document.createElement('button'); cancelBtn.textContent='Cancel'; cancelBtn.addEventListener('click', ()=>{ document.body.removeChild(overlay); });
          const saveBtn = document.createElement('button'); saveBtn.className='primary'; saveBtn.textContent='Save to Azure DevOps';
          saveBtn.addEventListener('click', async ()=>{
            const selected = Array.from(tbody.querySelectorAll('input[type="checkbox"]'))
              .filter(chk => chk.checked)
              .map(chk => {
                const id = chk.dataset.id; const ov = overrides[id]; return { id, start: ov.start, end: ov.end };
              });
            const res = await dataService.publishBaseline(selected);
            document.body.removeChild(overlay);
          });
          buttons.appendChild(cancelBtn); buttons.appendChild(saveBtn);
          modal.appendChild(buttons);
          // Toggle button logic: select all if any unchecked, otherwise deselect all
          toggleBtn.addEventListener('click', ()=>{
            const checks = Array.from(tbody.querySelectorAll('input[type="checkbox"]'));
            const anyUnchecked = checks.some(c=>!c.checked);
            checks.forEach(c=> c.checked = anyUnchecked);
          });
          overlay.appendChild(modal);
          document.body.appendChild(overlay);
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
  if(e.target.name==='loadViewMode' && e.target.checked){ state.setLoadViewMode(e.target.value); }
  if(e.target.name==='featureSortMode' && e.target.checked){ import('./state.js').then(m=> m.state.setFeatureSortMode(e.target.value)); }
}

function validateScenarioName(val){
  if(!val) return 'Name cannot be empty';
  const exists = state.scenarios.some(s => s.name.toLowerCase() === val.toLowerCase());
  if(exists) return 'Name already exists';
  return null;
}
