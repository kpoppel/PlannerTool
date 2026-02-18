import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { state } from '../services/State.js';

export class ViewRenameModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor(){ super(); this.id=''; this.name=''; }
  createRenderRoot(){ return this; }

  connectedCallback(){ super.connectedCallback(); }

  firstUpdated(){
    // open after render
    const inner = this.querySelector('modal-lit'); if(inner) inner.open = true;
    const saveBtn = this.querySelector('#renameViewBtn');
    const closeBtn = this.querySelector('#cancelRenameViewBtn');
    const input = this.querySelector('#renameViewInput');
    const status = this.querySelector('#renameViewStatus');
    saveBtn.addEventListener('click', async ()=>{
      const val = input.value.trim();
      if (!val) {
        status.textContent = 'Please enter a view name.';
        return;
      }
      this._disableButtons(true);
      try{
        await state.viewManagementService.renameView(this.id, val);
        this.remove();
      }catch(err){
        status.textContent = `Failed to rename view: ${err.message || err}`;
        this._disableButtons(false);
      }
    });
    closeBtn.addEventListener('click', ()=> this.remove());
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') saveBtn.click(); if(e.key==='Escape') closeBtn.click(); });
    setTimeout(()=> input.focus(), 10);
  }

  _disableButtons(dis){ 
    const saveBtn = this.querySelector('#renameViewBtn'); 
    const closeBtn = this.querySelector('#cancelRenameViewBtn'); 
    if(saveBtn) saveBtn.disabled = dis; 
    if(closeBtn) closeBtn.disabled = dis; 
  }

  render(){
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Rename View</h3></div>
        <div>
          <div class="modal-field">
            <label>Enter a new name for the view</label>
            <input id="renameViewInput" type="text" value="${this.name}" />
          </div>
          <div id="renameViewStatus" class="status"></div>
        </div>
        <div slot="footer" class="modal-footer">
          <button id="renameViewBtn" class="btn primary">Rename</button>
          <button id="cancelRenameViewBtn" class="btn">Cancel</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('view-rename-modal', ViewRenameModal);
