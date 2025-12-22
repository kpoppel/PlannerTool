import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';
import { dataService } from '../services/dataService.js';
import { state } from '../services/State.js';

export class ScenarioRenameModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor(){ super(); this.id=''; this.name=''; }
  createRenderRoot(){ return this; }

  connectedCallback(){ super.connectedCallback(); }

  firstUpdated(){
    // open after render
    const inner = this.querySelector('modal-lit'); if(inner) inner.open = true;
    const saveBtn = this.querySelector('#renameBtn');
    const closeBtn = this.querySelector('#cancelRenameBtn');
    const input = this.querySelector('#renameInput');
    const status = this.querySelector('#renameStatus');
    saveBtn.addEventListener('click', async ()=>{
      const val = input.value.trim();
      this._disableButtons(true);
      try{
        // Update local state first so sidebar and other UI update immediately
        try{ state.renameScenario(this.id, val); }catch(e){ /* ignore local state update errors */ }
        // Persist to backend (best-effort)
        await dataService.renameScenario(this.id, val).catch(()=>{});
        this.remove();
      }catch(err){ status.textContent = 'Rename failed.'; }
      this._disableButtons(false);
    });
    closeBtn.addEventListener('click', ()=> this.remove());
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') saveBtn.click(); if(e.key==='Escape') closeBtn.click(); });
    setTimeout(()=> input.focus(), 10);
  }

  _disableButtons(dis){ const saveBtn = this.querySelector('#renameBtn'); const closeBtn = this.querySelector('#cancelRenameBtn'); if(saveBtn) saveBtn.disabled = dis; if(closeBtn) closeBtn.disabled = dis; }

  render(){
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Rename Scenario</h3></div>
        <div>
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
