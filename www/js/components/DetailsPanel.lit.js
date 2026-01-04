import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import { UIEvents, FeatureEvents } from '../core/EventRegistry.js';
import { state } from '../services/State.js';

export class DetailsPanelLit extends LitElement {
  static properties = {
    feature: { type: Object },
    open: { type: Boolean },
    editingCapacityTeam: { type: String },
    showAddTeamPopover: { type: Boolean }
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
    /* Capacity Pills */
    .capacity-section { margin-top: 12px; }
    .capacity-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .capacity-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 16px;
      color: white;
      font-weight: 600;
      font-size: 11px;
      position: relative;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .capacity-pill:hover {
      filter: brightness(1.1);
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .capacity-pill-name { flex: 0 0 auto; }
    .capacity-pill-value {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px 6px;
      background: rgba(255,255,255,0.3);
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
      font-weight: bold;
      cursor: text;
    }
    .capacity-pill:hover .capacity-pill-value {
      background: rgba(255,255,255,0.5);
    }
    .capacity-pill-value.editing {
      background: white;
      color: #333;
      padding: 2px 4px;
    }
    .capacity-pill-value input {
      width: 30px;
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: center;
      outline: none;
      -moz-appearance: textfield;
    }
    .capacity-pill-value input::-webkit-outer-spin-button,
    .capacity-pill-value input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .capacity-pill-delete {
      display: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgba(255,255,255,0.3);
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
      transition: background 0.2s ease;
    }
    .capacity-pill:hover .capacity-pill-delete {
      display: flex;
      background: #e74c3c;
    }
    .capacity-pill-delete:hover {
      background: #c0392b !important;
    }
    .add-team-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 14px;
      border: 1.5px dashed #3498db;
      border-radius: 16px;
      background: white;
      color: #3498db;
      font-weight: 600;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
    }
    .add-team-btn:hover {
      background: #f0f8ff;
      border-color: #2980b9;
    }
    .add-team-popover {
      position: absolute;
      top: 100%;
      right: 0;
      left: auto;
      margin-top: 4px;
      padding: 12px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      min-width: 200px;
    }
    .add-team-popover select {
      width: 100%;
      padding: 6px 8px;
      margin: 4px 0;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 12px;
    }
    .add-team-popover input {
      width: 80px;
      padding: 6px 8px;
      margin: 4px 0;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 12px;
      -moz-appearance: textfield;
    }
    .add-team-popover input::-webkit-outer-spin-button,
    .add-team-popover input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .add-team-popover-buttons {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .add-team-popover button {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #3498db;
      color: white;
      font-size: 11px;
      cursor: pointer;
      font-weight: 600;
    }
    .add-team-popover button:hover {
      background: #2980b9;
    }
    .add-team-popover button.cancel {
      background: transparent;
      color: #666;
    }
    .add-team-popover button.cancel:hover {
      background: #f5f5f5;
    }
    .total-allocation-box {
      margin-top: 12px;
      padding: 12px;
      background: #fff8e6;
      border: 1.5px solid #f39c12;
      border-radius: 6px;
    }
    .total-allocation-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: bold;
      color: #e67e22;
      font-size: 11px;
      margin-bottom: 4px;
    }
    .total-allocation-value {
      font-size: 13px;
      font-weight: bold;
      color: #e67e22;
    }
    .total-allocation-note {
      font-size: 9px;
      color: #7f8c8d;
      margin-top: 4px;
    }
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
    this.editingCapacityTeam = null; // Track which team pill is being edited
    this.showAddTeamPopover = false; // Track if add team popover is visible
    this._onShow = this._onShow.bind(this);
  }

  /**
   * Strip [PlannerTool Team Capacity] block from description HTML for display.
   */
  _stripCapacityFromDescription(description) {
    if (!description) return '';
    // Remove the capacity block including HTML tags around it
    let cleaned = description.replace(
      /\[PlannerTool Team Capacity\][\s\S]*?\[\/PlannerTool Team Capacity\]/gi,
      ''
    );
    // Clean up extra whitespace and line breaks
    cleaned = cleaned.replace(/(<br\s*\/?>|\n){2,}/gi, '<br/>');
    cleaned = cleaned.trim();
    return cleaned;
  }

  connectedCallback(){
    super.connectedCallback();
    bus.on(UIEvents.DETAILS_SHOW, this._onShow);
    bus.on(FeatureEvents.SELECTED, this._onShow);
    bus.on(FeatureEvents.UPDATED, this._onFeatureUpdated.bind(this));
    bus.on(FeatureEvents.CAPACITY_UPDATED, this._onCapacityUpdated.bind(this));
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

  async _onCapacityUpdated(data) {
    const { featureId, capacity } = data;
    if (!featureId || !capacity) return;
    
    try {
      // Extract the numeric work item ID from the feature ID
      // Feature IDs are typically in format like "J_688051" or just the number
      const workItemId = String(featureId).replace(/^[A-Za-z_]+/, '');
      
      // Import dataService dynamically to avoid circular dependencies
      const { dataService } = await import('../services/dataService.js');
      
      // Call the API to update capacity in Azure DevOps
      const result = await dataService.updateWorkItemCapacity(workItemId, capacity);
      
      if (!result.ok) {
        console.error('Failed to update capacity:', result.error);
        // TODO: Show user-facing error notification
      } else {
        console.log('Successfully updated capacity for work item', workItemId);
      }
    } catch (error) {
      console.error('Error updating capacity:', error);
      // TODO: Show user-facing error notification
    }
  }

  _onFeatureUpdated(payload) {
    // Refresh feature data if the currently displayed feature was updated
    if (!this.open || !this.feature) return;
    
    const ids = payload?.ids || [];
    if (ids.includes(this.feature.id)) {
      // Get fresh feature data from state
      const updated = state.getEffectiveFeatureById(this.feature.id);
      if (updated) {
        this.feature = updated;
        this.requestUpdate();
      }
    }
  }

  disconnectedCallback(){
    bus.off(UIEvents.DETAILS_SHOW, this._onShow);
    bus.off(FeatureEvents.SELECTED, this._onShow);
    bus.off(FeatureEvents.UPDATED, this._onFeatureUpdated.bind(this));
    bus.off(FeatureEvents.CAPACITY_UPDATED, this._onCapacityUpdated.bind(this));
    super.disconnectedCallback();
  }

  _onShow(feature){
    this.feature = feature;
    this.open = true;
    this.requestUpdate();
  }

  hide(){ this.open = false; this.requestUpdate(); }

  _handleCapacityClick(teamId, e) {
    e.stopPropagation();
    if (!e.target.closest('.capacity-pill-delete')) {
      this.editingCapacityTeam = teamId;
      this.requestUpdate();
      // Focus the input after render
      setTimeout(() => {
        const input = this.shadowRoot.querySelector('.capacity-pill-value.editing input');
        if (input) {
          input.focus();
          input.select();
          // Add wheel event listener for 10% increments
          input.addEventListener('wheel', (wheelEvent) => {
            wheelEvent.preventDefault();
            const currentValue = parseInt(input.value) || 0;
            const delta = wheelEvent.deltaY < 0 ? 10 : -10; // Scroll up = +10, down = -10
            const newValue = Math.max(0, Math.min(100, currentValue + delta));
            // Round to nearest 10
            const roundedValue = Math.round(newValue / 10) * 10;
            input.value = roundedValue;
          }, { passive: false });
        }
      }, 0);
    }
  }

  _handleCapacityInputKeydown(teamId, e) {
    if (e.key === 'Enter') {
      this._saveCapacityEdit(teamId, e.target.value);
    } else if (e.key === 'Escape') {
      this.editingCapacityTeam = null;
      this.requestUpdate();
    }
  }

  _handleCapacityInputBlur(teamId, e) {
    this._saveCapacityEdit(teamId, e.target.value);
  }

  _saveCapacityEdit(teamId, newValue) {
    const capacity = parseInt(newValue) || 0;
    const clampedCapacity = Math.max(0, Math.min(100, capacity));
    
    // Create a new capacity array to avoid mutating the baseline
    if (this.feature && this.feature.capacity) {
      const newCapacity = this.feature.capacity.map(c => 
        c.team === teamId ? { ...c, capacity: clampedCapacity } : { ...c }
      );
      // Store as override in the scenario
      state.updateFeatureField(this.feature.id, 'capacity', newCapacity);
    }
    
    this.editingCapacityTeam = null;
    this.requestUpdate();
  }

  _handleDeleteCapacity(teamId, e) {
    e.stopPropagation();
    if (this.feature && this.feature.capacity) {
      // Create a new capacity array without the deleted team
      const newCapacity = this.feature.capacity.filter(c => c.team !== teamId);
      // Store as override in the scenario
      state.updateFeatureField(this.feature.id, 'capacity', newCapacity);
      this.requestUpdate();
    }
  }

  _handleAddTeamClick(e) {
    e.stopPropagation();
    this.showAddTeamPopover = !this.showAddTeamPopover;
    this.requestUpdate();
    // Add wheel event listener to the input after it renders
    if (this.showAddTeamPopover) {
      setTimeout(() => {
        const input = this.shadowRoot.querySelector('.add-team-popover input[type="number"]');
        if (input) {
          input.addEventListener('wheel', (wheelEvent) => {
            wheelEvent.preventDefault();
            const currentValue = parseInt(input.value) || 0;
            const delta = wheelEvent.deltaY < 0 ? 10 : -10;
            const newValue = Math.max(0, Math.min(100, currentValue + delta));
            const roundedValue = Math.round(newValue / 10) * 10;
            input.value = roundedValue;
          }, { passive: false });
        }
      }, 0);
    }
  }

  _handleAddTeamSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const teamSelect = form.querySelector('select');
    const capacityInput = form.querySelector('input');
    
    const teamId = teamSelect.value;
    const capacity = parseInt(capacityInput.value) || 0;
    const clampedCapacity = Math.max(0, Math.min(100, capacity));
    
    if (teamId && this.feature) {
      // Check if team already exists
      const currentCapacity = this.feature.capacity || [];
      const existing = currentCapacity.find(c => c.team === teamId);
      if (!existing) {
        // Create new array instead of mutating baseline
        const newCapacity = [...currentCapacity, { team: teamId, capacity: clampedCapacity }];
        // Store as override in the scenario
        state.updateFeatureField(this.feature.id, 'capacity', newCapacity);
      }
    }
    
    this.showAddTeamPopover = false;
    this.requestUpdate();
  }

  _handleAddTeamCancel() {
    this.showAddTeamPopover = false;
    this.requestUpdate();
  }

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
    
    // Use orgLoad for total allocation (organizational capacity allocated to this feature)
    const orgLoad = feature.orgLoad || '0%';
    const orgLoadValue = String(orgLoad).replace('%', '');
    
    // Render capacity pills
    const capacityPills = (feature.capacity || []).map(tl => {
      const t = state.teams.find(x => x.id === tl.team);
      if (!t) return null;
      
      const isEditing = this.editingCapacityTeam === tl.team;
      const cap = tl.capacity || 0;
      
      return html`
        <div class="capacity-pill" 
             style="background: ${t.color}"
             @click=${(e) => this._handleCapacityClick(tl.team, e)}>
          <span class="capacity-pill-name">${t.name}</span>
          <span class="capacity-pill-value ${isEditing ? 'editing' : ''}">
            ${isEditing 
              ? html`<input type="number" 
                            min="0" 
                            max="100" 
                            value="${cap}"
                            @keydown=${(e) => this._handleCapacityInputKeydown(tl.team, e)}
                            @blur=${(e) => this._handleCapacityInputBlur(tl.team, e)}/>`
              : html`${cap}`
            }
            <span>%</span>
          </span>
          <span class="capacity-pill-delete" 
                @click=${(e) => this._handleDeleteCapacity(tl.team, e)}>✕</span>
        </div>
      `;
    });
    
    // Get available teams for the add team dropdown (exclude already allocated teams)
    const allocatedTeamIds = new Set((feature.capacity || []).map(c => c.team));
    const availableTeams = state.teams.filter(t => !allocatedTeamIds.has(t.id));
    
    // Add team button with popover
    const addTeamButton = html`
      <div style="position: relative;">
        <div class="add-team-btn" @click=${(e) => this._handleAddTeamClick(e)}>
          + Add Team
        </div>
        ${this.showAddTeamPopover ? html`
          <form class="add-team-popover" @submit=${(e) => this._handleAddTeamSubmit(e)}>
            <select required>
              <option value="">Select Team...</option>
              ${availableTeams.map(t => html`<option value="${t.id}">${t.name}</option>`)}
            </select>
            <input type="number" min="0" max="100" placeholder="Capacity %" required />
            <div class="add-team-popover-buttons">
              <button type="submit">Add</button>
              <button type="button" class="cancel" @click=${() => this._handleAddTeamCancel()}>Cancel</button>
            </div>
          </form>
        ` : ''}
      </div>
    `;
    
    // Total allocation box - displays organizational capacity
    const totalAllocationBox = orgLoadValue && parseFloat(orgLoadValue) > 0 ? html`
      <div class="total-allocation-box">
        <div class="total-allocation-header">
          Total Allocation:
          <span class="total-allocation-value">${orgLoad}</span>
        </div>
      </div>
    ` : '';
    
    // Strip capacity section from description
    const cleanDescription = this._stripCapacityFromDescription(feature.description);

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
          
          <div class="capacity-section">
            <div class="details-label">Allocated Capacity:</div>
            <div class="capacity-pills">
              ${capacityPills}
              ${addTeamButton}
            </div>
            ${totalAllocationBox}
          </div>
          
          <div class="details-label">Description</div>
          <div class="details-value" .innerHTML=${cleanDescription || '—'}></div>
          <div class="details-label">Links:</div>
          <div class="details-value">${relationsTemplate}</div>
          ${changedBanner}
        </div>
      </div>
    `;
  }
}

customElements.define('details-panel', DetailsPanelLit);

