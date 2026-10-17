import { LitElement, html } from '../vendor/lit.js';
import './Modal.lit.js';
import { cmd, sel } from '../application/imports.js';
import { store } from '../application/store.js';
import { dataService } from '../services/dataService.js';

export class ScenarioDeleteModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor() {
    super();
    this.id = '';
    this.name = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsubscribeScenario = store.subscribe((state) => state.scenarios, (next, previous) => {
      if (next.activeId !== previous.activeId || !sel.scenario.getScenarioAccess(this.id).canEdit) this._cancelDenied();
    });
  }

  disconnectedCallback() {
    this._unsubscribeScenario();
    super.disconnectedCallback();
  }

  _cancelDenied() {
    this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true, composed: true }));
    this.remove();
  }

  _getInner() {
    return this.renderRoot.querySelector('modal-lit');
  }

  _qs(selector) {
    const inner = this._getInner();
    return inner ? inner.querySelector(selector) : null;
  }

  firstUpdated() {
    if (!sel.scenario.getScenarioAccess(this.id).canEdit) { this._cancelDenied(); return; }
    const inner = this._getInner();
    if (inner) inner.open = true;
    const delBtn = this._qs('#deleteBtn');
    const cancelBtn = this._qs('#cancelDeleteBtn');
    const status = this._qs('#deleteStatus');
    if (delBtn)
      delBtn.addEventListener('click', async () => {
        if (!sel.scenario.getScenarioAccess(this.id).canEdit) { this._cancelDenied(); return; }
        delBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        try {
          cmd.scenario.deleteScenario(this.id);
          await dataService.deleteScenario(this.id).catch(() => {});
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
    if (!sel.scenario.getScenarioAccess(this.id).canEdit) return html``;
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
