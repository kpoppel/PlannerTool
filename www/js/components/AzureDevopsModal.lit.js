import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';

export class AzureDevopsModal extends LitElement {
  static properties = {
    overrides: { type: Object },
    state: { type: Object }
  };

  constructor(){ super(); this.overrides = {}; this.state = null; this._selected = new Set(); }

  firstUpdated(){
    // Start with no items selected by default for safety
    // User must explicitly check items they want to annotate
    // open the inner modal once rendered
    const inner = this.renderRoot ? this.renderRoot.querySelector('modal-lit') : this.querySelector('modal-lit'); if(inner) inner.open = true;
  }

  _formatRange(from, to){
    if(!from && !to) return '';
    if(!from) return to;
    if(!to) return from;
    if(from === to) return from;
    return `${from} -> ${to}`;
  }

  _toggleAll(){
    const keys = Object.keys(this.overrides || {});
    const anyUnchecked = keys.some(k=> !this._selected.has(k));
    if(anyUnchecked) keys.forEach(k=> this._selected.add(k)); else keys.forEach(k=> this._selected.delete(k));
    this.requestUpdate();
  }

  _onCheckboxChange(e){
    const id = e.target.dataset.id;
    if(e.target.checked) this._selected.add(id); else this._selected.delete(id);
    this.requestUpdate();
  }

  _onSave(){
    const selected = Array.from(this._selected).map(id => {
      const ov = this.overrides[id] || {};
      const out = { id, start: ov.start, end: ov.end, capacity: ov.capacity };
      if (ov.state) out.state = ov.state;
      return out;
    });
    this.dispatchEvent(new CustomEvent('azure-save', { detail: selected, bubbles: true, composed: true }));
    this.remove();
  }

  _onCancel(){ this.remove(); }

  render(){
    const allEntries = Object.entries(this.overrides || {});
    
    // Filter to only show features with actual changes (include state)
    const entries = allEntries.filter(([id, ov]) => {
      const baseFeature = (this.state && this.state.baselineFeatures) ? (this.state.baselineFeatures.find(f=>f.id===id) || {}) : {};
      const origStart = baseFeature.start || '';
      const origEnd = baseFeature.end || '';
      const origCapacity = baseFeature.capacity || [];
      const origState = baseFeature.state || baseFeature.status || '';
      
      // Check if there are actual changes
      const hasStartChange = ov.start && ov.start !== origStart;
      const hasEndChange = ov.end && ov.end !== origEnd;
      const hasCapacityChange = ov.capacity && JSON.stringify(ov.capacity) !== JSON.stringify(origCapacity);
      const hasStateChange = ov.state && ov.state !== origState;
      
      return hasStartChange || hasEndChange || hasCapacityChange || hasStateChange;
    });
    
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Save to Azure DevOps</h3></div>
        <div>
          <style>
            p {
              margin: 0 0 16px 0;
              color: #333;
              font-size: 14px;
            }
            .scenario-annotate-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 13px;
              background: #fff;
            }
            .scenario-annotate-table thead {
              background: #f5f5f5;
              position: sticky;
              top: 0;
            }
            .scenario-annotate-table th {
              padding: 10px 12px;
              text-align: left;
              font-weight: 600;
              color: #333;
              border: 1px solid #ddd;
              border-bottom: 2px solid #bbb;
            }
            .scenario-annotate-table td {
              padding: 10px 12px;
              border: 1px solid #ddd;
              vertical-align: top;
              color: #333;
            }
            .scenario-annotate-table tbody tr {
              background: #fff;
            }
            .scenario-annotate-table tbody tr:nth-child(even) {
              background: #fafafa;
            }
            .scenario-annotate-table tbody tr:hover {
              background: #f0f7ff;
            }
            .scenario-annotate-table input[type="checkbox"] {
              cursor: pointer;
              width: 16px;
              height: 16px;
            }
            .scenario-annotate-table td:first-child {
              text-align: center;
            }
            .scenario-annotate-table strong {
              color: #000;
              font-weight: 600;
            }
            .btn {
              padding: 6px 12px;
              background: #e9e9e9;
              border: 1px solid rgba(0,0,0,0.06);
              border-radius: 6px;
              cursor: pointer;
              color: #333;
              font-size: 13px;
            }
            .btn:hover {
              background: #e0e0e0;
            }
          </style>
          <p>Select which items to annotate back to Azure DevOps:</p>
          ${entries.length === 0 ? html`<p style="color:#888;">No changes to save.</p>` : html`
          <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
            <button type="button" @click=${this._toggleAll} class="btn">Toggle All/None</button>
          </div>
          <div style="max-height:60vh;overflow-y:auto;padding-right:8px;">
            <table class="scenario-annotate-table">
              <thead><tr><th style="width:64px">Select</th><th>Title</th><th>Start</th><th>End</th><th>Capacity</th><th>State</th></tr></thead>
              <tbody>
                ${entries.map(([id, ov]) => {
                  const baseFeature = (this.state && this.state.baselineFeatures) ? (this.state.baselineFeatures.find(f=>f.id===id) || {}) : {};
                  const origStart = baseFeature.start || '';
                  const origEnd = baseFeature.end || '';
                  const origCapacity = baseFeature.capacity || [];
                  const origState = baseFeature.state || baseFeature.status || '';
                  const checked = this._selected.has(id);
                  
                  // Format capacity changes with details
                  let capacityChange = '';
                  if (ov.capacity) {
                    const hasChanges = JSON.stringify(ov.capacity) !== JSON.stringify(origCapacity);
                    if (hasChanges) {
                      // Show detailed capacity changes
                      const teams = this.state?.teams || [];
                      const changes = [];
                      
                      // Build maps for comparison
                      const origMap = new Map(origCapacity.map(c => [c.team, c.capacity]));
                      const newMap = new Map(ov.capacity.map(c => [c.team, c.capacity]));
                      
                      // Find all teams involved (added, removed, or modified)
                      const allTeams = new Set([...origMap.keys(), ...newMap.keys()]);
                      
                      for (const teamId of allTeams) {
                        const origVal = origMap.get(teamId);
                        const newVal = newMap.get(teamId);
                        const team = teams.find(t => t.id === teamId);
                        const teamName = team?.name || teamId;
                        
                        if (origVal === undefined && newVal !== undefined) {
                          // Added
                          changes.push(html`<div><strong>${teamName}:</strong> +${newVal}%</div>`);
                        } else if (origVal !== undefined && newVal === undefined) {
                          // Removed
                          changes.push(html`<div><strong>${teamName}:</strong> ${origVal}% → removed</div>`);
                        } else if (origVal !== newVal) {
                          // Modified
                          changes.push(html`<div><strong>${teamName}:</strong> ${origVal}% → ${newVal}%</div>`);
                        }
                      }
                      
                      capacityChange = html`${changes}`;
                    }
                  }
                  
                  return html`<tr>
                    <td><input type="checkbox" .checked=${checked} data-id=${id} @change=${this._onCheckboxChange} /></td>
                    <td>${this.state ? this.state.getFeatureTitleById(id) : id}</td>
                    <td>${this._formatRange(origStart, ov.start)}</td>
                    <td>${this._formatRange(origEnd, ov.end)}</td>
                    <td style="font-size:0.9em;line-height:1.4;">${capacityChange}</td>
                    <td style="font-size:0.9em;line-height:1.4;">${ov.state && ov.state !== origState ? html`<div><strong>${origState || '—'}</strong> → <strong>${ov.state}</strong></div>` : html`${origState || '—'}`}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>
          `}
        </div>
        <div slot="footer" class="modal-footer">
          <button class="btn" @click=${this._onCancel}>Cancel</button>
          ${entries.length > 0 ? html`<button class="btn primary" @click=${this._onSave}>Save to Azure DevOps</button>` : ''}
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('azure-devops-modal', AzureDevopsModal);
