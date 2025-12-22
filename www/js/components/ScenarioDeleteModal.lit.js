import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { state } from '../services/State.js';
import { dataService } from '../services/dataService.js';

export class ScenarioDeleteModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor(){ super(); this.id=''; this.name=''; }
  createRenderRoot(){ return this; }

  firstUpdated(){
    const inner = this.querySelector('modal-lit'); if(inner) inner.open = true;
    const delBtn = this.querySelector('#deleteBtn');
    const cancelBtn = this.querySelector('#cancelDeleteBtn');
    const status = this.querySelector('#deleteStatus');
    delBtn.addEventListener('click', async ()=>{
      delBtn.disabled = true; cancelBtn.disabled = true;
      try{
        try{ state.deleteScenario(this.id); }catch(e){}
        await dataService.deleteScenario(this.id).catch(()=>{});
        this.remove();
      }catch(err){ status.textContent = 'Delete failed.'; }
      delBtn.disabled = false; cancelBtn.disabled = false;
    });
    cancelBtn.addEventListener('click', ()=> this.remove());
  }

  render(){
    return html`
      <modal-lit>
        <div slot="header"><h3>Delete Scenario</h3></div>
        <div>
          <p>Delete scenario "${this.name}"? This cannot be undone.</p>
          <div id="deleteStatus" class="status"></div>
        </div>
        <div slot="footer" class="modal-footer">
          <button id="deleteBtn" class="btn primary">Delete</button>
          <button id="cancelDeleteBtn" class="btn">Cancel</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('scenario-delete-modal', ScenarioDeleteModal);
