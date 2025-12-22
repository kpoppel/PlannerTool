import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';

export class AzureDevopsModal extends LitElement {
  static properties = {
    overrides: { type: Object },
    state: { type: Object }
  };

  constructor(){ super(); this.overrides = {}; this.state = null; this._selected = new Set(); }
  createRenderRoot(){ return this; }

  firstUpdated(){
    // initialize selected to all present overrides
    const entries = Object.keys(this.overrides || {});
    entries.forEach(k=> this._selected.add(k));
    // open the inner modal once rendered
    const inner = this.querySelector('modal-lit'); if(inner) inner.open = true;
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
  }

  _onSave(){
    const selected = Array.from(this._selected).map(id => {
      const ov = this.overrides[id] || {};
      return { id, start: ov.start, end: ov.end };
    });
    this.dispatchEvent(new CustomEvent('azure-save', { detail: selected, bubbles: true, composed: true }));
    this.remove();
  }

  _onCancel(){ this.remove(); }

  render(){
    const entries = Object.entries(this.overrides || {});
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Save to Azure DevOps</h3></div>
        <div>
          <p>Select which items to annotate back to Azure DevOps:</p>
          <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
            <button type="button" @click=${this._toggleAll} class="btn">Toggle All/None</button>
          </div>
          <div style="max-height:60vh;overflow-y:auto;padding-right:8px;">
            <table class="scenario-annotate-table">
              <thead><tr><th style="width:64px">Select</th><th>Title</th><th>Start</th><th>End</th></tr></thead>
              <tbody>
                ${entries.map(([id, ov]) => {
                  const baseFeature = (this.state && this.state.baselineFeatures) ? (this.state.baselineFeatures.find(f=>f.id===id) || {}) : {};
                  const origStart = baseFeature.start || '';
                  const origEnd = baseFeature.end || '';
                  const checked = this._selected.has(id);
                  return html`<tr>
                    <td><input type="checkbox" .checked=${checked} data-id=${id} @change=${this._onCheckboxChange} /></td>
                    <td>${this.state ? this.state.getFeatureTitleById(id) : id}</td>
                    <td>${this._formatRange(origStart, ov.start)}</td>
                    <td>${this._formatRange(origEnd, ov.end)}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div slot="footer" class="modal-footer">
          <button class="btn" @click=${this._onCancel}>Cancel</button>
          <button class="btn primary" @click=${this._onSave}>Save to Azure DevOps</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('azure-devops-modal', AzureDevopsModal);
