import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';
import { state } from '../services/State.js';

export class ScenarioCloneModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor(){ super(); this.id=''; this.name=''; }
  createRenderRoot(){ return this; }

  connectedCallback(){ super.connectedCallback(); }

  firstUpdated(){
    // open after render
    const inner = this.querySelector('modal-lit'); if(inner) inner.open = true;
    const saveBtn = this.querySelector('#cloneBtn');
    const closeBtn = this.querySelector('#cancelCloneBtn');
    const input = this.querySelector('#cloneInput');
    const status = this.querySelector('#cloneStatus');
    saveBtn.addEventListener('click', async ()=>{
      const val = input.value.trim();
      this._disableButtons(true);
      try{
        const newScen = state.cloneScenario(this.id, val);
        if(newScen) state.activateScenario(newScen.id);
        this.remove();
      }catch(err){ status.textContent = 'Clone failed.'; }
      this._disableButtons(false);
    });
    closeBtn.addEventListener('click', ()=> this.remove());
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') saveBtn.click(); if(e.key==='Escape') closeBtn.click(); });
    setTimeout(()=> input.focus(), 10);
  }

  _disableButtons(dis){ const saveBtn = this.querySelector('#cloneBtn'); const closeBtn = this.querySelector('#cancelCloneBtn'); if(saveBtn) saveBtn.disabled = dis; if(closeBtn) closeBtn.disabled = dis; }

  render(){
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Clone Scenario</h3></div>
        <div>
          <div class="modal-field">
            <label>Create a new scenario from this one</label>
            <input id="cloneInput" type="text" value="${this.name}" />
          </div>
          <div id="cloneStatus" class="status"></div>
        </div>
        <div slot="footer" class="modal-footer">
          <button id="cloneBtn" class="btn primary">Clone</button>
          <button id="cancelCloneBtn" class="btn">Cancel</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('scenario-clone-modal', ScenarioCloneModal);
