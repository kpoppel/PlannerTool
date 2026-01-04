import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import { UIEvents, FeatureEvents } from '../core/EventRegistry.js';
import { state } from '../services/State.js';

export class DetailsPanelLit extends LitElement {
  static properties = {
    feature: { type: Object },
    open: { type: Boolean }
  };

  static styles = css`
    :host { display:block; }
    .panel {
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: var(--details-width, 340px);
      background: var(--color-panel-bg, #f9f9f9);
      border-left: 1px solid var(--color-border, #ccc);
      box-shadow: -2px 0 8px var(--color-shadow, rgba(0,0,0,0.08));
      z-index: var(--z-details, 1000);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel.closed { display: none; }
    .details-header {
      position: relative;
      padding: 22px 18px 8px 18px;
      flex: 0 0 auto;
    }
    .details-content {
      padding: 0 18px 22px 18px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      flex: 1 1 auto;
    }
    /* match app font sizing and rhythm */
    :host { font-size: 14px; }
    .details-label { font-weight: bold; margin-top: 6px; font-size: 14px; }
    .details-value { margin-bottom: 8px; font-size: 14px; }
    .details-changed { background: #fadd92ff; }
    .details-change-banner { background: #fff8e6; border: 1px solid #f0d7a6; padding: 8px 10px; border-radius: 6px; margin-top: 8px; font-size: 13px; display:flex; gap:8px; align-items:center; }
    .details-revert { background: transparent; border: 1px solid #ccc; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .original-date { color: #666; font-size: 12px; margin-left: 6px; }
    .details-close { position: absolute; right: 18px; top: 18px; cursor: pointer; border: none; background: transparent; font-size: 18px; }
    .team-load-box { padding: 4px 8px; border-radius: 6px; color: white; font-weight: 600; margin-right: 6px; font-size: 12px; }
    .azure-relations-list { list-style: none; padding: 0; margin: 0; }
    /* align icon with text baseline for pixel-accurate centering */
    .azure-relation-item { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
    .relation-icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; font-size: 14px; }
    .relation-title, .relation-title a.details-link { line-height: 18px; display: inline-block; vertical-align: middle; }
    .relation-content { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }
    .relation-content > * { margin: 0; padding: 0; }
    .relation-title { margin: 0; line-height: 1.1; }
    .relation-title a.details-link { display: inline; color: var(--color-accent, #3498db); text-decoration: underline; line-height: 1.1; }
    .state-chip { display:inline-block; padding:4px 8px; border-radius:12px; font-weight:600; font-size:13px; vertical-align:middle; }
  `;

  constructor(){
    super();
    this.feature = null;
    this.open = false;
    this._onShow = this._onShow.bind(this);
  }

  connectedCallback(){
    super.connectedCallback();
    bus.on(UIEvents.DETAILS_SHOW, this._onShow);
    bus.on(FeatureEvents.SELECTED, this._onShow);
    //TODO: Should the side panel receive update if it is shown and the feature is changed?
    //TODO: Should standardise what is sent on events (full feature vs id only)

    document.body.addEventListener('click', (e) => {
      if(!this.open) return;
      const path = e.composedPath ? e.composedPath() : [];
      // If click occurred inside this host or inside a feature-card (host or shadow internals), do not hide
      const clickedInsideHost = path.includes(this);
      const clickedFeatureCard = path.some(p => {
        try{
          if(!p) return false;
          // shadow internals will have classList; host elements might be custom tags
          if(p.classList && p.classList.contains && p.classList.contains('feature-card')) return true;
          if(p.tagName && String(p.tagName).toLowerCase() === 'feature-card-lit') return true;
          if(p.tagName && String(p.tagName).toLowerCase() === 'feature-card') return true;
        }catch(e){ }
        return false;
      });
      if(!clickedInsideHost && !clickedFeatureCard){ this.hide(); }
    });
  }

  disconnectedCallback(){
    bus.off(UIEvents.DETAILS_SHOW, this._onShow);
    bus.off(FeatureEvents.SELECTED, this._onShow);
    super.disconnectedCallback();
  }

  _onShow(feature){
    this.feature = feature;
    this.open = true;
    this.requestUpdate();
  }

  hide(){ this.open = false; this.requestUpdate(); }

  _renderField(label, field, value){
    const original = this.feature && this.feature.original ? this.feature.original[field] : undefined;
    const changed = original !== undefined && value !== original;
    const cls = changed ? 'details-value details-changed' : 'details-value';
    const originalSpan = changed ? html` <span class="original-date" title="Original">(was ${original})</span>` : '';
    return html`<div class="details-label">${label}:</div><div class="${cls}">${value||'—'}${originalSpan}</div>`;
  }

  render(){
    if(!this.open || !this.feature) return html`<div class="panel closed"></div>`;
    const feature = this.feature;
    const statusClass = feature.state==='In Progress'? 'status-inprogress' : feature.state==='Done'? 'status-done' : 'status-new';
    // Build a state color chip using state service helper
    // Use ColorService directly
    const stateColors = state._colorService ? state._colorService.getFeatureStateColors(state.availableFeatureStates) : {};
    const stateColor = (feature && feature.state && stateColors[feature.state]) ? stateColors[feature.state] : null;
    const orgBox = html`<span class="team-load-box" style="background:#23344d" title="Org Load">Org: ${feature.orgLoad||'0%'}</span>`;
    const teamBoxes = (feature.capacity||[]).map(tl => {
      const t = state.teams.find(x=>x.id===tl.team);
      if(!t) return null;
      // show team name + capacity (add % if value looks like percent or number)
      const cap = String(tl.capacity || '0');
      const displayCap = cap.match(/\d+%?$/) ? cap : (cap.match(/^\d+$/) ? `${cap}%` : cap);
      return html`<span class="team-load-box" style="background:${t.color}" title="${t.name}">${t.name}: ${displayCap}</span>`;
    });

    const changedSet = new Set(feature.changedFields || []);
    const changedBanner = changedSet.size ? html`<div class="details-change-banner">${html`<button class="details-revert" title="Revert changes" @click=${(ev)=>{ ev.stopPropagation(); state.revertFeature(feature.id); }}>↺</button>`} Modified locally (${[...changedSet].join(', ')})</div>` : '';

    // Build relations HTML similarly to legacy renderer
    let relationsTemplate = html`<div class="details-value">—</div>`;
    try{
      const rels = Array.isArray(feature.relations) ? feature.relations.slice() : [];
      if(rels.length){
        // Sort and group like legacy
        rels.sort((a,b) => {
          const ta = (a.type || a.relationType || 'Related');
          const tb = (b.type || b.relationType || 'Related');
          if(ta === 'Parent' && tb !== 'Parent') return -1;
          if(tb === 'Parent' && ta !== 'Parent') return 1;
          return 0;
        });
        const groups = new Map();
        for(const r of rels){
          const type = (r.type || r.relationType || 'Related');
          if(!groups.has(type)) groups.set(type, []);
          groups.get(type).push(r);
        }
        const orderedKeys = [];
        if(groups.has('Parent')) orderedKeys.push('Parent');
        for(const k of groups.keys()){ if(k !== 'Parent') orderedKeys.push(k); }

        const groupsArr = orderedKeys.map(type => {
          const items = (groups.get(type) || []).map(r => {
            const otherId = r.id ? String(r.id) : null;
            let url = r.url || '';
            if(!url && feature.url && otherId){ url = feature.url.replace(/(\d+)(?!.*\d)/, otherId); }
            const href = url ? url : '';
            let title = '';
            try{ const linked = state && state.baselineFeatureById && state.baselineFeatureById.get(otherId); if(linked && linked.title) title = linked.title; }catch(e){}
            let metaParts = [];
            try{ const linked = state && state.baselineFeatureById && state.baselineFeatureById.get(otherId); if(linked && linked.status) metaParts.push(linked.status); }catch(e){}
            const meta = metaParts.join(' • ');
            const icon = type === 'Parent' ? '👑' : (type === 'Successor' ? '➡️' : (type === 'Predecessor' ? '⬅️' : '🔗'));
            return html`<li class="azure-relation-item"><div class="relation-icon">${icon}</div><div class="relation-content"><div class="relation-title"><a class="details-link" href="${href}" target="_blank">${otherId? otherId : ''}${title? ' ' + title : ''}</a></div></div></li>`;
          });
          return html`<div class="relations-group"><div class="group-title">${type}</div><ul class="azure-relations-list">${items}</ul></div>`;
        });
        relationsTemplate = html`${groupsArr}`;
      }
    } catch(e){ relationsTemplate = html`<div class="details-value">—</div>`; }

    return html`
      <div class="panel">
        <div class="details-header">
          <button class="details-close" @click=${()=>this.hide()} aria-label="Close details">✕</button>
          <div class="details-label">Feature ${feature.title}</div>
          <div class="details-label">ID: <a class="details-link" href="${feature.url||'#'}" target="_blank">⤴ ${feature.id}</a></div>
          <div class="details-label">Status: <span class="${statusClass}">${feature.state}</span> ${stateColor ? html`<span class="state-chip" style="background:${stateColor.background}; color:${stateColor.text}">${feature.state}</span>` : ''}</div>
        </div>
        <div class="details-content">
          ${this._renderField('Assignee','assignee', feature.assignee)}
          ${this._renderField('Start Date','start', feature.start)}
          ${this._renderField('End Date','end', feature.end)}
          <div class="details-label">Description</div>
          <div class="details-value" .innerHTML=${feature.description || '—'}></div>
          <div class="details-label">Team Load:</div>
          <div class="details-value" style="display:flex; flex-wrap:wrap; gap:6px;">${orgBox}${teamBoxes}</div>
          <div class="details-label">Links:</div>
          <div class="details-value">${relationsTemplate}</div>
          ${changedBanner}
        </div>
      </div>
    `;
  }
}

customElements.define('details-panel', DetailsPanelLit);

