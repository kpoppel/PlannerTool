import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';
import { dataService } from '../services/dataService.js';
import { state } from '../services/State.js';

export class ScenarioRenameModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor(){ super(); this.id=''; this.name=''; }
  
  connectedCallback(){ super.connectedCallback(); }

  _getInner(){
    return this.renderRoot.querySelector('modal-lit');
  }
  
  _qs(selector){
    const inner = this._getInner();
    return inner ? inner.querySelector(selector) : null;
  }

  firstUpdated(){
    // open after render
    const inner = this._getInner(); if(inner) inner.open = true;
    const saveBtn = this._qs('#renameBtn');
    const closeBtn = this._qs('#cancelRenameBtn');
    const input = this._qs('#renameInput');
    const status = this._qs('#renameStatus');
    if (saveBtn) saveBtn.addEventListener('click', async ()=>{
      const val = input.value.trim();
      this._disableButtons(true);
      try{
        // Update local state first so sidebar and other UI update immediately
        try{ state.renameScenario(this.id, val); }catch(e){ /* ignore local state update errors */ }
        // Persist to backend (best-effort)
        await dataService.renameScenario(this.id, val).catch(()=>{});
        this.remove();
      }catch(err){ if (status) status.textContent = 'Rename failed.'; }
      this._disableButtons(false);
    });
    if (closeBtn) closeBtn.addEventListener('click', ()=> this.remove());
    if (input) input.addEventListener('keydown', e=>{ if(e.key==='Enter') saveBtn.click(); if(e.key==='Escape') closeBtn.click(); });
    if (input) setTimeout(()=> input.focus(), 10);
  }

  _disableButtons(dis){ const saveBtn = this._qs('#renameBtn'); const closeBtn = this._qs('#cancelRenameBtn'); if(saveBtn) saveBtn.disabled = dis; if(closeBtn) closeBtn.disabled = dis; }

  render(){
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Rename Scenario</h3></div>
        <div>
          <style>
            .modal-field {
              margin-bottom: 16px;
            }
            .modal-field label {
              display: block;
              margin-bottom: 6px;
              font-weight: 500;
              color: #333;
              font-size: 14px;
            }
            .modal-field input {
              width: 100%;
              padding: 8px 10px;
              border: 1px solid #ccc;
              border-radius: 4px;
              font-size: 14px;
              font-family: inherit;
            }
            .modal-field input:focus {
              outline: 2px solid rgba(52, 152, 219, 0.3);
              border-color: #3498db;
            }
            .status {
              margin-top: 12px;
              padding: 8px;
              border-radius: 4px;
              font-size: 14px;
              color: #d32f2f;
              background: #ffebee;
            }
            .status:empty {
              display: none;
            }
          </style>
          <div class="modal-field">
            <label>Enter a new unique name for the scenario</label>
            <input id="renameInput" type="text" value="${this.name}" />
          </div>
          <div id="renameStatus" class="status"></div>
        </div>
        <div slot="footer" class="modal-footer">
          <button id="renameBtn" class="btn primary">Rename</button>
          <button id="cancelRenameBtn" class="btn">Cancel</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('scenario-rename-modal', ScenarioRenameModal);
