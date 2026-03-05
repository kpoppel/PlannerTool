import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { state } from '../services/State.js';

export class ViewRenameModal extends LitElement {
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
    const saveBtn = this._qs('#renameViewBtn');
    const closeBtn = this._qs('#cancelRenameViewBtn');
    const input = this._qs('#renameViewInput');
    const status = this._qs('#renameViewStatus');
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
    if (closeBtn) closeBtn.addEventListener('click', ()=> this.remove());
    if (input) input.addEventListener('keydown', e=>{ if(e.key==='Enter') saveBtn.click(); if(e.key==='Escape') closeBtn.click(); });
    if (input) setTimeout(()=> input.focus(), 10);
  }

  _disableButtons(dis){ 
    const saveBtn = this._qs('#renameViewBtn'); 
    const closeBtn = this._qs('#cancelRenameViewBtn'); 
    if(saveBtn) saveBtn.disabled = dis; 
    if(closeBtn) closeBtn.disabled = dis; 
  }

  render(){
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Rename View</h3></div>
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
