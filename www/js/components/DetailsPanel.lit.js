import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import { UIEvents, FeatureEvents } from '../core/EventRegistry.js';
import { state } from '../services/State.js';
import { epicTemplate, featureTemplate } from '../services/IconService.js';

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
    .title-icon { display:inline-flex; width:20px; height:20px; vertical-align:middle; margin-right:8px; }
    .details-value { margin-bottom: 8px; font-size: 14px; }
    .details-changed { background: #fadd92ff; }
    .details-change-banner { background: #fff8e6; border: 1px solid #f0d7a6; padding: 8px 10px; border-radius: 6px; margin-top: 8px; font-size: 13px; display:flex; gap:8px; align-items:center; }
    .details-revert { background: transparent; border: 1px solid #ccc; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .original-date { color: #666; font-size: 12px; margin-left: 6px; }
    .details-close { position: absolute; right: 18px; top: 18px; cursor: pointer; border: none; background: transparent; font-size: 18px; }
    .team-load-box { padding: 4px 8px; border-radius: 6px; color: white; font-weight: 600; margin-right: 6px; font-size: 12px; }
    .azure-relations-list { list-style: none; padding: 0; margin: 0; }
    /* Capacity Progress Bars */
    .capacity-section { margin-top: 12px; }
    .capacity-bars { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .capacity-bar-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      position: relative;
    }
    .capacity-bar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 16px;
    }
    .capacity-bar-name {
      font-size: 13px;
      font-weight: 600;
      color: #2c3e50;
    }
    .capacity-bar-delete {
      display: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      border: 1.5px solid #dc3545;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
      opacity: 0.7;
      transition: all 0.2s ease;
    }
    .capacity-bar-row:hover .capacity-bar-delete {
      display: flex;
    }
    .capacity-bar-delete:hover {
      background: #dc3545 !important;
      opacity: 1;
    }
    .capacity-bar-delete:hover::before {
      color: #ffffff;
    }
    .capacity-bar-container {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 18px;
    }
    .capacity-bar-bg {
      flex: 1;
      height: 18px;
      background: #e9ecef;
      border-radius: 9px;
      position: relative;
      overflow: hidden;
      cursor: pointer;
      transition: box-shadow 0.2s ease;
    }
    .capacity-bar-row:hover .capacity-bar-bg {
      box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3);
    }
    .capacity-bar-fill {
      height: 100%;
      border-radius: 9px;
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .capacity-bar-label {
      font-family: Arial, sans-serif;
      font-size: 11px;
      font-weight: bold;
      color: white;
      text-shadow: 0 1px 2px rgba(0,0,0,0.2);
    }
    .capacity-bar-input-container {
      flex: 0 0 auto;
      position: relative;
    }
    .capacity-bar-input {
      width: 50px;
      height: 14px;
      padding: 2px 4px;
      border: 1px solid #ccc;
      border-radius: 3px;
      background: rgba(255,255,255,0.9);
      font-family: monospace;
      font-size: 10px;
      text-align: center;
      outline: none;
      -moz-appearance: textfield;
      cursor: text;
      transition: border-color 0.2s ease;
    }
    .capacity-bar-input:focus {
      border-color: #3498db;
      border-width: 2px;
      background: white;
    }
    .capacity-bar-input::-webkit-outer-spin-button,
    .capacity-bar-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .add-team-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .add-team-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 18px;
      border: 1.5px dashed #3498db;
      border-radius: 9px;
      background: white;
      color: #3498db;
      font-weight: 600;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 8px;
    }
    .add-team-btn:hover {
      background: #f0f8ff;
      border-color: #2980b9;
    }
    .add-team-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      background: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 6px;
    }
    .add-team-form select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 11px;
    }
    .details-changed { background: #fadd92ff; }
    .details-change-banner { background: #fff8e6; border: 1px solid #f0d7a6; padding: 8px 10px; border-radius: 6px; margin-top: 8px; font-size: 13px; display:flex; gap:8px; align-items:center; }
    .details-revert { background: transparent; border: 1px solid #ccc; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .original-date { color: #666; font-size: 12px; margin-left: 6px; }
    .details-close { position: absolute; right: 18px; top: 18px; cursor: pointer; border: none; background: transparent; font-size: 18px; }
    .team-load-box { padding: 4px 8px; border-radius: 6px; color: white; font-weight: 600; margin-right: 6px; font-size: 12px; }
    .azure-relations-list { list-style: none; padding: 0; margin: 0; }
    /* Capacity Progress Bars */
    .capacity-section { margin-top: 12px; }
    .capacity-bars { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .capacity-bar-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      position: relative;
    }
    .capacity-bar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 16px;
    }
    .capacity-bar-name {
      font-size: 13px;
      font-weight: 600;
      color: #2c3e50;
    }
    .capacity-bar-delete {
      display: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      border: 1.5px solid #dc3545;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
      opacity: 0.7;
      transition: all 0.2s ease;
    }
    .capacity-bar-row:hover .capacity-bar-delete {
      display: flex;
    }
    .capacity-bar-delete:hover {
      background: #dc3545 !important;
      opacity: 1;
    }
    .capacity-bar-delete:hover::before {
      color: #ffffff;
    }
    .capacity-bar-container {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 18px;
    }
    .capacity-bar-bg {
      flex: 1;
      height: 18px;
      background: #e9ecef;
      border-radius: 9px;
      position: relative;
      overflow: hidden;
      cursor: pointer;
      transition: box-shadow 0.2s ease;
    }
    .capacity-bar-row:hover .capacity-bar-bg {
      box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3);
    }
    .capacity-bar-fill {
      height: 100%;
      border-radius: 9px;
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .capacity-bar-label {
      font-family: Arial, sans-serif;
      font-size: 11px;
      font-weight: bold;
      color: white;
      text-shadow: 0 1px 2px rgba(0,0,0,0.2);
    }
    .capacity-bar-input-container {
      flex: 0 0 auto;
      position: relative;
    }
    .capacity-bar-input {
      width: 50px;
      height: 14px;
      padding: 2px 4px;
      border: 1px solid #ccc;
      border-radius: 3px;
      background: rgba(255,255,255,0.9);
      font-family: monospace;
      font-size: 10px;
      text-align: center;
      outline: none;
      -moz-appearance: textfield;
      cursor: text;
      transition: border-color 0.2s ease;
    }
    .capacity-bar-input:focus {
      border-color: #3498db;
      border-width: 2px;
      background: white;
    }
    .capacity-bar-input::-webkit-outer-spin-button,
    .capacity-bar-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .add-team-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .add-team-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 18px;
      border: 1.5px dashed #3498db;
      border-radius: 9px;
      background: white;
      color: #3498db;
      font-weight: 600;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 8px;
    }
    .add-team-btn:hover {
      background: #f0f8ff;
      border-color: #2980b9;
    }
    .add-team-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      background: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 6px;
    }
    .add-team-form select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 11px;
    }
    .add-team-form-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .add-team-form input {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 11px;
      -moz-appearance: textfield;
    }
    .add-team-form input::-webkit-outer-spin-button,
    .add-team-form input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .add-team-form-buttons {
      display: flex;
      gap: 6px;
    }
    .add-team-form button {
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
    .add-team-form button:hover {
      background: #2980b9;
    }
    .add-team-form button.cancel {
      background: transparent;
      color: #666;
    }
    .add-team-form button.cancel:hover {
      background: #f5f5f5;
    }
    .total-allocation-box {
      margin-top: 16px;
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
      color: #856404;
      font-size: 10px;
      margin-bottom: 8px;
    }
    .total-allocation-summary-bar {
      height: 20px;
      background: #e9ecef;
      border-radius: 10px;
      overflow: hidden;
      display: flex;
    }
    .total-allocation-segment {
      height: 100%;
      transition: width 0.3s ease;
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

  // Note: use component's shadow DOM (default) so component styles apply correctly

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

  async _shrinkwrapEpic(e){
    e && e.stopPropagation();
    if(!this.feature) return;
    const f = this.feature;
    if(f.type !== 'epic') return;

    try{
      // childrenByEpic uses baseline ids as keys; try both string/number
      const childIds = state.childrenByEpic.get(f.id) || state.childrenByEpic.get(String(f.id)) || state.childrenByEpic.get(Number(f.id)) || [];
      if(!childIds || !childIds.length) return;

      // Use effective feature dates (respecting active scenario overrides)
      let minStartMs = null;
      let maxEndMs = null;
      for(const cid of childIds){
        const eff = state.getEffectiveFeatureById(cid);
        if(!eff) continue;
        const s = eff.start;
        const e = eff.end;
        if(s){
          const sMs = Date.parse(s);
          if(!isNaN(sMs) && (minStartMs === null || sMs < minStartMs)) minStartMs = sMs;
        }
        if(e){
          const eMs = Date.parse(e);
          if(!isNaN(eMs) && (maxEndMs === null || eMs > maxEndMs)) maxEndMs = eMs;
        }
      }
      if(minStartMs === null || maxEndMs === null) return;

      const toIsoDate = (ms) => new Date(ms).toISOString().slice(0,10);
      const newStart = toIsoDate(minStartMs);
      const newEnd = toIsoDate(maxEndMs);

      // Use state.updateFeatureDates to update both start and end together
      state.updateFeatureDates([{ id: f.id, start: newStart, end: newEnd }]);
    }catch(err){
      console.error('Shrinkwrap epic failed', err);
    }
  }

  hide(){ this.open = false; this.requestUpdate(); }

  _handleCapacityClick(teamId, e) {
    e.stopPropagation();
    // Click on bar focuses the input
    const row = e.target.closest('.capacity-bar-row');
    if (row) {
      const input = row.querySelector('.capacity-bar-input');
      if (input) {
        input.focus();
        input.select();
      }
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
    
    // Render capacity bars
    const capacityBars = (feature.capacity || []).map(tl => {
      const t = state.teams.find(x => x.id === tl.team);
      if (!t) return null;
      
      const cap = tl.capacity || 0;
      const barWidth = `${Math.min(cap, 100)}%`;
      
      return html`
        <div class="capacity-bar-row">
          <div class="capacity-bar-header">
            <span class="capacity-bar-name">${t.name}</span>
            <span class="capacity-bar-delete" 
                  @click=${(e) => this._handleDeleteCapacity(tl.team, e)}>✕</span>
          </div>
          <div class="capacity-bar-container">
            <div class="capacity-bar-bg" @click=${(e) => this._handleCapacityClick(tl.team, e)}>
              <div class="capacity-bar-fill" style="width: ${barWidth}; background: ${t.color};">
                <span class="capacity-bar-label">${cap}%</span>
              </div>
            </div>
            <div class="capacity-bar-input-container">
              <input type="number" 
                     class="capacity-bar-input"
                     min="0" 
                     max="100" 
                     value="${cap}"
                     @keydown=${(e) => this._handleCapacityInputKeydown(tl.team, e)}
                     @blur=${(e) => this._handleCapacityInputBlur(tl.team, e)}
                     @focus=${(e) => { e.target.select(); }}
                     @wheel=${(e) => {
                       e.preventDefault();
                       const currentValue = parseInt(e.target.value) || 0;
                       const delta = e.deltaY < 0 ? 10 : -10;
                       const newValue = Math.max(0, Math.min(100, currentValue + delta));
                       const roundedValue = Math.round(newValue / 10) * 10;
                       e.target.value = roundedValue;
                       this._saveCapacityEdit(tl.team, roundedValue);
                     }}/>
            </div>
          </div>
        </div>
      `;
    });
    
    // Get available teams for the add team dropdown (exclude already allocated teams)
    const allocatedTeamIds = new Set((feature.capacity || []).map(c => c.team));
    const availableTeams = state.teams.filter(t => !allocatedTeamIds.has(t.id));
    
    // Add team button with inline form
    const addTeamButton = html`
      <div class="add-team-row">
        ${this.showAddTeamPopover ? html`
          <form class="add-team-form" @submit=${(e) => this._handleAddTeamSubmit(e)}>
            <select required>
              <option value="">Select Team...</option>
              ${availableTeams.map(t => html`<option value="${t.id}">${t.name}</option>`)}
            </select>
            <div class="add-team-form-input-row">
              <input type="number" min="0" max="100" placeholder="Capacity %" required 
                     @wheel=${(e) => {
                       e.preventDefault();
                       const currentValue = parseInt(e.target.value) || 0;
                       const delta = e.deltaY < 0 ? 10 : -10;
                       const newValue = Math.max(0, Math.min(100, currentValue + delta));
                       const roundedValue = Math.round(newValue / 10) * 10;
                       e.target.value = roundedValue;
                     }}/>
            </div>
            <div class="add-team-form-buttons">
              <button type="submit">Add</button>
              <button type="button" class="cancel" @click=${() => this._handleAddTeamCancel()}>Cancel</button>
            </div>
          </form>
        ` : html`
          <div class="add-team-btn" @click=${(e) => this._handleAddTeamClick(e)}>
            + Add Team
          </div>
        `}
      </div>
    `;
    
    // Total allocation box - displays organizational capacity with visual summary
    let totalAllocationBox = '';
    if (orgLoadValue && parseFloat(orgLoadValue) > 0) {
      const totalCapacity = (feature.capacity || []).reduce((sum, c) => sum + (c.capacity || 0), 0);
      const teamCount = (feature.capacity || []).length;
      
      // Build segments for visual bar
      const segments = (feature.capacity || []).map(tl => {
        const t = state.teams.find(x => x.id === tl.team);
        if (!t) return null;
        const cap = tl.capacity || 0;
        // Calculate width as percentage of total available width (scale to max 100% visual width)
        const widthPercent = totalCapacity > 0 ? (cap / Math.max(totalCapacity, 100)) * 100 : 0;
        return html`<div class="total-allocation-segment" style="width: ${widthPercent}%; background: ${t.color};"></div>`;
      }).filter(s => s);
      
      totalAllocationBox = html`
        <div class="total-allocation-box">
          <div class="total-allocation-header">
            Total Capacity Overview: <span style="color: #e67e22;">${orgLoad} across ${teamCount} team${teamCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="total-allocation-summary-bar">
            ${segments}
          </div>
        </div>
      `;
    }
    
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
            let iconTemplate = '';
            if (type === 'Parent') iconTemplate = epicTemplate;
            else if (type === 'Successor') iconTemplate = '➡️';
            else if (type === 'Predecessor') iconTemplate = '⬅️';
            else iconTemplate = '🔗';
            return html`<li class="azure-relation-item"><div class="relation-icon">${iconTemplate}</div><div class="relation-content"><div class="relation-title"><a class="details-link" href="${href}" target="_blank">${otherId? otherId : ''}${title? ' ' + title : ''}</a></div></div></li>`;
          });
          return html`<div class="relations-group"><div class="group-title">${type}</div><ul class="azure-relations-list">${items}</ul></div>`;
        });
        relationsTemplate = html`${groupsArr}`;
      }
    } catch(e){ relationsTemplate = html`<div class="details-value">—</div>`; }

    if (feature && feature.type && String(feature.type).toLowerCase() === 'epic') {
      console.debug('[DetailsPanel] rendering shrinkwrap button for epic', feature.id);
    }

    return html`
      <div class="panel" data-tour="details-panel">
        <div class="details-header">
          <button class="details-close" @click=${()=>this.hide()} aria-label="Close details">✕</button>
          <div class="details-label">
            <span class="title-icon" >${feature.type === 'epic' ? epicTemplate : featureTemplate}</span>
            <span>${feature.title}</span>
          </div>
          <div class="details-label">ID: <a class="details-link" href="${feature.url||'#'}" target="_blank">⤴ ${feature.id}</a></div>
          <div class="details-label">Status: <span class="${statusClass}">${feature.state}</span> ${stateColor ? html`<span class="state-chip" style="background:${stateColor.background}; color:${stateColor.text}">${feature.state}</span>` : ''}</div>
        </div>
        <div class="details-content">
          ${this._renderField('Assignee','assignee', feature.assignee)}
          ${(() => {
            // stacked dates section
            const orig = feature.original || {};
            const startOrig = orig.start;
            const endOrig = orig.end;
            const startChanged = startOrig !== undefined && feature.start !== startOrig;
            const endChanged = endOrig !== undefined && feature.end !== endOrig;
              return html`
                <div class="details-label">Dates</div>
                <div style="display:flex;flex-direction:row;gap:12px;align-items:flex-start;">
                  <div style="flex:1;min-width:0;">
                    <div class="details-label">Start</div>
                    <div class="details-value ${startChanged ? 'details-changed' : ''}">${feature.start || '—'}</div>
                    ${startChanged ? html`<div class="original-date">(was ${startOrig})</div>` : ''}
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div class="details-label">End</div>
                    <div class="details-value ${endChanged ? 'details-changed' : ''}">${feature.end || '—'}</div>
                    ${endChanged ? html`<div class="original-date">(was ${endOrig})</div>` : ''}
                  </div>
                </div>
              ${feature && feature.type && String(feature.type).toLowerCase() === 'epic' ? html`<div style="margin-top:8px;"><button data-test="shrinkwrap-chip" class="chip" @click=${(e)=>this._shrinkwrapEpic(e)} title="Shrinkwrap epic to children" aria-label="Shrinkwrap epic to children" style="display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:12px;border:1px solid rgba(35,52,77,0.12);background:rgba(35,52,77,0.12);font-size:0.85rem;color:inherit;"><svg width="20" height="16" viewBox="0 0 20 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="flex:0 0 auto;">
                        <rect x="0.5" y="0.5" width="3" height="15" fill="currentColor" />
                        <rect x="16.5" y="0.5" width="3" height="15" fill="currentColor" />
                        <polygon points="6.5,4 10,8 6.5,12" fill="currentColor" />
                        <polygon points="13.5,4 10,8 13.5,12" fill="currentColor" />
                        <rect x="9" y="7.2" width="2" height="1.6" fill="currentColor" />
                    </svg><span style="display:inline-block;line-height:1;">Shink Epic</span></button></div>` : ''}
              `;
          })()}
          
          <div class="capacity-section">
            <div class="details-label">Allocated Capacity:</div>
            <div class="capacity-bars">
              ${capacityBars}
            </div>
            ${addTeamButton}
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

