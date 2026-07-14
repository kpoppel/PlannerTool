import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';
import { applicationApi as plannerApi } from '../application/plannerApplication.js';

export class ScenarioCloneModal extends LitElement {
  static properties = { id: { type: String }, name: { type: String } };

  constructor() {
    super();
    this.id = '';
    this.name = '';
  }

  firstUpdated() {
    // open after render
    const inner = this.renderRoot.querySelector('modal-lit');
    if (inner) inner.open = true;
    const saveBtn = this.renderRoot.querySelector('#cloneBtn');
    const closeBtn = this.renderRoot.querySelector('#cancelCloneBtn');
    const input = this.renderRoot.querySelector('#cloneInput');
    const status = this.renderRoot.querySelector('#cloneStatus');
    if (saveBtn)
      saveBtn.addEventListener('click', async () => {
        const val = input.value.trim();
        this._disableButtons(true);
        try {
          const newScen = plannerApi.scenarios.clone(this.id, val);
          if (newScen) plannerApi.scenarios.activate(newScen.id);
          this.remove();
        } catch (err) {
          if (status) status.textContent = 'Clone failed.';
        }
        this._disableButtons(false);
      });
    if (closeBtn) closeBtn.addEventListener('click', () => this.remove());
    if (input)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveBtn.click();
        if (e.key === 'Escape') closeBtn.click();
      });
    if (input) setTimeout(() => input.focus(), 10);
  }

  _disableButtons(dis) {
    const saveBtn = this.renderRoot.querySelector('#cloneBtn');
    const closeBtn = this.renderRoot.querySelector('#cancelCloneBtn');
    if (saveBtn) saveBtn.disabled = dis;
    if (closeBtn) closeBtn.disabled = dis;
  }

  render() {
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Clone Scenario</h3></div>
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
