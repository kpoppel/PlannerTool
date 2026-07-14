import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { applicationApi as plannerApi } from '../application/plannerApplication.js';

export class ScenarioDeleteModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor() {
    super();
    this.id = '';
    this.name = '';
  }

  firstUpdated() {
    const inner = this.renderRoot.querySelector('modal-lit');
    if (inner) inner.open = true;
    const delBtn = this.renderRoot.querySelector('#deleteBtn');
    const cancelBtn = this.renderRoot.querySelector('#cancelDeleteBtn');
    const status = this.renderRoot.querySelector('#deleteStatus');
    if (delBtn)
      delBtn.addEventListener('click', async () => {
        delBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        try {
          plannerApi.scenarios.delete(this.id);
          this.remove();
        } catch (err) {
          if (status) status.textContent = 'Delete failed.';
        }
        delBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
      });
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.remove());
  }

  render() {
    return html`
      <modal-lit>
        <div slot="header"><h3>Delete Scenario</h3></div>
        <div>
          <style>
            p {
              margin: 0 0 16px 0;
              color: #333;
              font-size: 14px;
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
