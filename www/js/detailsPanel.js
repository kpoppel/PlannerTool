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
  const statusClass = feature.state==='In Progress'? 'status-inprogress' : feature.state==='Done'? 'status-done' : 'status-new';

  // Helper to render a field with dirty highlighting.
  function renderField(label, field, value){
    const original = feature.original ? feature.original[field] : undefined;
    const changed = original !== undefined && value !== original;
    const cls = changed ? 'details-value details-changed' : 'details-value';
    const originalSpan = changed ? ` <span class="original-date" title="Original">(was ${original})</span>` : '';
    return `<div class="details-label">${label}:</div><div class="${cls}">${value||'—'}${originalSpan}</div>`;
  }

  // Build colored team load boxes
  const orgBox = `<span class="team-load-box" style="background:#23344d" title="Org Load">Org: ${feature.orgLoad||'0%'}</span>`;
  const teamBoxes = feature.capacity.map(tl => {
    const t = state.teams.find(x=>x.id===tl.team);
    if(!t) return '';
    return `<span class="team-load-box" style="background:${t.color}" title="${t.name}">${t.name}: ${tl.capacity}%</span>`;
  }).join('');

  // Determine list of changed fields generically
  const changedSet = new Set(feature.changedFields || []);
  const revertBtn = feature.dirty ? `<button class="details-revert" title="Revert changes" data-revert="${feature.id}">↺</button>` : '';
  const changedBanner = changedSet.size ? `<div class="details-change-banner">${revertBtn} Modified locally (${[...changedSet].join(', ')})</div>` : '';
  // Build Azure relations list HTML from feature.relations
  let relationsHtml = '';
  try{
    const rels = Array.isArray(feature.relations) ? feature.relations.slice() : [];
    if(rels.length){
      // Sort relations: Parent first, then others (preserve relative order among same types)
      rels.sort((a,b) => {
        const ta = (a.type || a.relationType || 'Related');
        const tb = (b.type || b.relationType || 'Related');
        if(ta === 'Parent' && tb !== 'Parent') return -1;
        if(tb === 'Parent' && ta !== 'Parent') return 1;
        return 0;
      });
      // Group by type preserving order
      const groups = new Map();
      for(const r of rels){
        const type = (r.type || r.relationType || 'Related');
        if(!groups.has(type)) groups.set(type, []);
        groups.get(type).push(r);
      }
      // Preferred ordering: Parent first (if present), then others in insertion order
      const orderedKeys = [];
      if(groups.has('Parent')) orderedKeys.push('Parent');
      for(const k of groups.keys()){ if(k !== 'Parent') orderedKeys.push(k); }

      const groupHtml = orderedKeys.map(type => {
        const entries = groups.get(type) || [];
        const items = entries.map(r => {
          const otherId = r.id ? String(r.id) : null;
          let url = r.url || '';
          if(!url && feature.url && otherId){ url = feature.url.replace(/(\d+)(?!.*\d)/, otherId); }
          const href = url ? `href="${url}" target="_blank"` : '';
          let title = '';
          try{ const linked = state && state.baselineFeatureById && state.baselineFeatureById.get(otherId); if(linked && linked.title) title = linked.title; }catch(e){}
          // meta: status and optionally updated text
          let metaParts = [];
          try{ const linked = state && state.baselineFeatureById && state.baselineFeatureById.get(otherId); if(linked && linked.status) metaParts.push(linked.status); }catch(e){}
          const meta = metaParts.join(' • ');
          // choose an icon per type (emoji fallback)
          const icon = type === 'Parent' ? '👑' : (type === 'Successor' ? '➡️' : (type === 'Predecessor' ? '⬅️' : '🔗'));
          return `
            <li class="azure-relation-item">
              <div class="relation-icon">${icon}</div>
              <div class="relation-content">
                <div class="relation-title"><a class="details-link" ${href}>${otherId? otherId : ''}${title? ' ' + title : ''}</a></div>
                <div class="relation-meta">${meta || '&nbsp;'}</div>
              </div>
            </li>`;
        }).join('');
        return `<div class="relations-group"><div class="group-title">${type}</div><ul class="azure-relations-list">${items}</ul></div>`;
      }).join('');
      relationsHtml = groupHtml;
    } else {
      relationsHtml = `<div class="details-value">—</div>`;
    }
  } catch(e){ relationsHtml = `<div class="details-value">—</div>`; }

  content.innerHTML = `
    <div class="details-label">Feature ${feature.title}</div>
    <div class="details-label">ID: <a class="details-link" href="${feature.url||'#'}" target="_blank">⤴ ${feature.id}</a></div>
    <div class="details-label">Status: <span class="${statusClass}">${feature.state}</span></div>
    ${renderField('Assignee', 'assignee', feature.assignee)}
    ${renderField('Start Date', 'start', feature.start)}
    ${renderField('End Date', 'end', feature.end)}
    ${renderField('Description', 'description', feature.description)}
    <div class="details-label">Team Load:</div>
    <div class="details-value" style="display:flex; flex-wrap:wrap; gap:6px;">${orgBox + teamBoxes}</div>
    <div class="details-label">Links:</div>
    <div class="details-value">${relationsHtml}</div>
    ${changedBanner}
  `;
  if(feature.dirty){
    const btn = content.querySelector('.details-revert');
    if(btn){ btn.addEventListener('click', ev => { ev.stopPropagation(); state.revertFeature(feature.id); }); }
  }
}

function hide(){ panel.classList.remove('open'); panel.hidden=true; }
