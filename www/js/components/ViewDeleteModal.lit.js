import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { state } from '../services/State.js';

export class ViewDeleteModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor(){ super(); this.id=''; this.name=''; }
  createRenderRoot(){ return this; }

  firstUpdated(){
    const inner = this.querySelector('modal-lit'); if(inner) inner.open = true;
    const delBtn = this.querySelector('#deleteViewBtn');
    const cancelBtn = this.querySelector('#cancelDeleteViewBtn');
    const status = this.querySelector('#deleteViewStatus');
    delBtn.addEventListener('click', async ()=>{
      delBtn.disabled = true; cancelBtn.disabled = true;
      try{
        await state.viewManagementService.deleteView(this.id);
        this.remove();
      }catch(err){
        status.textContent = `Failed to delete view: ${err.message || err}`;
        delBtn.disabled = false; 
        cancelBtn.disabled = false;
      }
    });
    cancelBtn.addEventListener('click', ()=> this.remove());
  }

  render(){
    return html`
      <modal-lit>
        <div slot="header"><h3>Delete View</h3></div>
        <div>
          <p>Delete view "${this.name}"? This cannot be undone.</p>
          <div id="deleteViewStatus" class="status"></div>
        </div>
        <div slot="footer" class="modal-footer">
          <button id="deleteViewBtn" class="btn primary">Delete</button>
          <button id="cancelDeleteViewBtn" class="btn">Cancel</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('view-delete-modal', ViewDeleteModal);
