import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import './Modal.lit.js';
import { ConfigEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';

class ConfigModal extends LitElement {
  static properties = {
    open: { type: Boolean },
  };

  constructor() {
    super();
    this.open = false;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  _getInner() {
    return this.renderRoot.querySelector('modal-lit');
  }

  _qs(selector) {
    const inner = this._getInner();
    return inner ? inner.querySelector(selector) : null;
  }

  async _populate() {
    const emailInput = this._qs('#configEmail');
    const autosaveInput = this._qs('#autosaveInterval');
    const storedEmail = await dataService.getLocalPref('user.email');
    if (storedEmail) emailInput.value = storedEmail;
    const storedAutosave = await dataService.getLocalPref('autosave.interval');
    if (storedAutosave !== undefined && autosaveInput)
      autosaveInput.value = storedAutosave;
  }

  render() {
    return html`
      <modal-lit wide>
        <div slot="header"><h3>Configuration</h3></div>
        <div>
          <style>
            .config-form {
              display: block;
              max-width: 640px;
              width: 100%;
              box-sizing: border-box;
            }
            .form-row {
              margin-bottom: 16px;
            }
            .form-row label {
              display: block;
              margin-bottom: 6px;
              font-weight: 500;
              color: #333;
              font-size: 14px;
            }
            .form-row input {
              width: 100%;
              max-width: 100%;
              box-sizing: border-box;
              padding: 8px 10px;
              border: 1px solid #ccc;
              border-radius: 4px;
              font-size: 14px;
              font-family: inherit;
            }
            .form-row input:focus {
              outline: 2px solid rgba(52, 152, 219, 0.3);
              border-color: #3498db;
            }
            .status {
              margin-top: 12px;
              padding: 8px;
              border-radius: 4px;
              font-size: 14px;
              color: #333;
              background: #f0f0f0;
            }
            .status:empty {
              display: none;
            }
          </style>
          <form id="configForm" class="config-form">
            <div class="form-row">
              <label for="configEmail">Email address</label>
              <input
                type="email"
                id="configEmail"
                placeholder="you@example.com"
                required
              />
            </div>
            <div class="form-row">
              <label for="configPat">Personal Access Token (PAT)</label>
              <input type="password" id="configPat" placeholder="••••••••" />
            </div>
            <div class="form-row">
              <label for="autosaveInterval">Autosave interval (minutes, 0=off)</label>
              <input
                type="number"
                id="autosaveInterval"
                min="0"
                max="120"
                step="1"
                value="0"
              />
            </div>
            <div id="configStatus" class="status" aria-live="polite"></div>
          </form>
        </div>
        <div slot="footer" class="modal-footer">
          <button id="saveConfigBtn" class="btn primary">Save</button>
          <button id="closeConfigBtn" class="btn">Close</button>
        </div>
      </modal-lit>
    `;
  }

  firstUpdated() {
    // Populate now that the element has rendered and inputs are present
    this._populate();

    const form = this._qs('#configForm');
    const closeBtn = this._qs('#closeConfigBtn');
    const status = this._qs('#configStatus');
    const emailInput = this._qs('#configEmail');
    const patInput = this._qs('#configPat');
    const autosaveInput = this._qs('#autosaveInterval');

    // Save handler wired to Save button so the footer button can trigger form submit
    const saveBtn = this._qs('#saveConfigBtn');
    if (saveBtn)
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        const pat = patInput.value;
        const autosaveInterval = parseInt(autosaveInput.value, 10) || 0;
        if (email) await dataService.setLocalPref('user.email', email);
        await dataService.setLocalPref('autosave.interval', autosaveInterval);
        let patText = '';
        if (pat) patText = 'Access token updated.';
        try {
          const res = await dataService.saveConfig({ email, pat });
          if (res && res.ok) {
            status.textContent = 'Configuration saved. ' + patText;
          } else {
            status.textContent = 'Configuration saved locally, but server save failed.';
          }
        } catch (err) {
          status.textContent = 'Configuration saved locally, but server save failed.';
        }
        bus.emit(ConfigEvents.UPDATED, { email });
        bus.emit(ConfigEvents.AUTOSAVE, { autosaveInterval });
      });

    if (closeBtn)
      closeBtn.addEventListener('click', () => {
        const innerModal = this._getInner();
        if (innerModal && typeof innerModal.close === 'function') innerModal.close();
        else this._close();
      });

    // Ensure the inner modal is opened after the <modal-lit> definition is available
    customElements
      .whenDefined('modal-lit')
      .then(() => {
        const innerModal = this._getInner();
        if (innerModal) {
          innerModal.addEventListener('modal-close', () => this.remove());
          innerModal.open = true;
        }
      })
      .catch(() => {
        // If definition never arrives, still attempt to open any existing inner modal
        const innerModal = this._getInner();
        if (innerModal) {
          innerModal.open = true;
        }
      });
    // Ensure the email input is focused when the inner modal is opened
    const tryFocusEmail = () => {
      const emailInput = this._qs('#configEmail');
      // small timeout to allow any modal open animation to complete
      setTimeout(() => emailInput.focus(), 60);
    };
    // If modal-lit exists now, focus after it's opened
    const existingInner = this._getInner();
    if (existingInner) {
      // If modal-lit exposes open property, watch for it or attempt immediate focus
      if (existingInner.open) tryFocusEmail();
      else {
        existingInner.addEventListener('modal-open', tryFocusEmail, {
          once: true,
        });
      }
    }
  }

  _overlayClick(e) {
    const innerModal = this._getInner();
    if (innerModal && typeof innerModal.close === 'function') innerModal.close();
  }

  _close() {
    const innerModal = this._getInner();
    if (innerModal && typeof innerModal.close === 'function') innerModal.close();
    this.remove();
  }
}

customElements.define('config-modal', ConfigModal);
