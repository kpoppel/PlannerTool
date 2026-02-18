import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { state } from '../services/State.js';

export class ViewSaveModal extends LitElement {
  static properties = { name: { type: String } };

  constructor(){ super(); this.name=''; }
  createRenderRoot(){ return this; }

  connectedCallback(){ super.connectedCallback(); }

  firstUpdated(){
    // open after render
    const inner = this.querySelector('modal-lit'); if(inner) inner.open = true;
    const saveBtn = this.querySelector('#saveViewBtn');
    const closeBtn = this.querySelector('#cancelSaveViewBtn');
    const input = this.querySelector('#saveViewInput');
    const status = this.querySelector('#saveViewStatus');
    saveBtn.addEventListener('click', async ()=>{
      const val = input.value.trim();
      if (!val) {
        status.textContent = 'Please enter a view name.';
        return;
      }
      this._disableButtons(true);
      try{
        await state.viewManagementService.saveCurrentView(val);
        this.remove();
      }catch(err){
        status.textContent = `Failed to save view: ${err.message || err}`;
        this._disableButtons(false);
      }
    });
    closeBtn.addEventListener('click', ()=> this.remove());
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') saveBtn.click(); if(e.key==='Escape') closeBtn.click(); });
    setTimeout(()=> input.focus(), 10);
  }

  _disableButtons(dis){ 
    const saveBtn = this.querySelector('#saveViewBtn'); 
    const closeBtn = this.querySelector('#cancelSaveViewBtn'); 
    if(saveBtn) saveBtn.disabled = dis; 
    if(closeBtn) closeBtn.disabled = dis; 
  }

  render(){
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Save View</h3></div>
        <div>
          <div class="modal-field">
            <label>Save current selections and filters as a new view</label>
            <input id="saveViewInput" type="text" value="${this.name}" placeholder="Enter view name..." />
          </div>
          <div id="saveViewStatus" class="status"></div>
        </div>
        <div slot="footer" class="modal-footer">
          <button id="saveViewBtn" class="btn primary">Save</button>
          <button id="cancelSaveViewBtn" class="btn">Cancel</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('view-save-modal', ViewSaveModal);
