import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { state } from '../services/State.js';

export class ViewDeleteModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor() {
    super();
    this.id = '';
    this.name = '';
  }

  connectedCallback() {
    super.connectedCallback();
  }

  _getInner() {
    return this.renderRoot.querySelector('modal-lit');
  }

  _qs(selector) {
    const inner = this._getInner();
    return inner ? inner.querySelector(selector) : null;
  }

  firstUpdated() {
    const inner = this._getInner();
    if (inner) inner.open = true;
    const delBtn = this._qs('#deleteViewBtn');
    const cancelBtn = this._qs('#cancelDeleteViewBtn');
    const status = this._qs('#deleteViewStatus');
    if (delBtn)
      delBtn.addEventListener('click', async () => {
        delBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        try {
          await state.viewManagementService.deleteView(this.id);
          this.remove();
        } catch (err) {
          if (status) status.textContent = `Failed to delete view: ${err.message || err}`;
          delBtn.disabled = false;
          if (cancelBtn) cancelBtn.disabled = false;
        }
      });
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.remove());
  }

  render() {
    return html`
      <modal-lit>
        <div slot="header"><h3>Delete View</h3></div>
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
