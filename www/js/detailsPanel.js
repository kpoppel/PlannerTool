import { bus } from './eventBus.js';
import { state } from './state.js';

let panel, content, closeBtn;

export function initDetailsPanel(){
  panel = document.getElementById('detailsPanel');
  content = document.getElementById('detailsContent');
  closeBtn = document.getElementById('detailsCloseBtn');
  closeBtn.addEventListener('click', hide);
  document.body.addEventListener('click', (e)=>{ if(panel.classList.contains('open')){ if(!panel.contains(e.target) && !e.target.closest('.feature-card')) hide(); } });
  bus.on('details:show', show);
}

function show(feature){
  panel.classList.add('open'); panel.hidden=false;
  const statusClass = feature.status==='In Progress'? 'status-inprogress' : feature.status==='Done'? 'status-done' : 'status-new';

  // Helper to render a field with dirty highlighting.
  function renderField(label, field, value){
    const original = feature.original ? feature.original[field] : undefined;
    const changed = original !== undefined && value !== original;
    const cls = changed ? 'details-value details-changed' : 'details-value';
    const originalSpan = changed ? ` <span class="original-date" title="Original">(was ${original})</span>` : '';
    return `<div class="details-label">${label}:</div><div class="${cls}">${value||'—'}${originalSpan}</div>`;
  }

  // Build colored team load boxes
  const orgBox = `<span class="team-load-box" style="background:#23344d" title="Org Load">Org: ${feature.orgLoad}%</span>`;
  const teamBoxes = feature.teamLoads.map(tl => {
    const t = state.teams.find(x=>x.id===tl.team);
    if(!t) return '';
    return `<span class="team-load-box" style="background:${t.color}" title="${t.name}">${t.name}: ${tl.load}%</span>`;
  }).join('');

  // Determine list of changed fields generically
  const changedSet = new Set(feature.changedFields || []);
  const revertBtn = feature.dirty ? `<button class="details-revert" title="Revert changes" data-revert="${feature.id}">↺</button>` : '';
  const changedBanner = changedSet.size ? `<div class="details-change-banner">${revertBtn} Modified locally (${[...changedSet].join(', ')})</div>` : '';

  content.innerHTML = `
    <div class="details-label">Feature ${feature.title}</div>
    <div class="details-value">ID: ${feature.id}</div>
    <div class="details-label">Status: <span class="${statusClass}">${feature.status}</span></div>
    ${renderField('Assignee', 'assignee', feature.assignee)}
    ${renderField('Start Date', 'start', feature.start)}
    ${renderField('End Date', 'end', feature.end)}
    ${renderField('Description', 'description', feature.description)}
    <div class="details-label">Team Load:</div>
    <div class="details-value" style="display:flex; flex-wrap:wrap; gap:6px;">${orgBox + teamBoxes}</div>
    <div class="details-label">Azure DevOps:</div>
    <div class="details-value"><a class="details-link" href="${feature.azureUrl||'#'}" target="_blank">Open</a></div>
    ${changedBanner}
  `;
  if(feature.dirty){
    const btn = content.querySelector('.details-revert');
    if(btn){ btn.addEventListener('click', ev => { ev.stopPropagation(); state.revertFeature(feature.id); }); }
  }
}

function hide(){ panel.classList.remove('open'); panel.hidden=true; }
