import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import './Modal.lit.js';
import { ConfigEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import { showAccountDeletionDialog } from './AuthDialog.lit.js';

class ConfigModal extends LitElement {
  static properties = {
    open: { type: Boolean },
    _signingOut: { state: true },
  };

  constructor() {
    super();
    this.open = false;
    this._signingOut = false;
    this._deletionDialog = null;
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

  async _signOut() {
    if (this._signingOut) return;
    if (!window.confirm('Sign out of this browser? PlannerTool preferences, cached data, and local drafts will be removed. Save your work first. You will need your current account key to enroll again.')) return;
    this._signingOut = true;
    const status = this._qs('#configStatus');
    status.textContent = 'Signing out...';
    try {
      await dataService.signOut();
      window.location.reload();
    } catch (error) {
      console.error('Signing out failed', error);
      status.textContent = 'Could not sign out. Please try again.';
      this._signingOut = false;
    }
  }

  async _deleteAccount() {
    if (this._signingOut || (this._deletionDialog && this._deletionDialog.isConnected)) return;
    this._signingOut = true;
    try {
      const response = await fetch(`${window.APP_BASE_URL}/api/auth/me`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Could not load the current account');
      const account = await response.json();
      this._deletionDialog = showAccountDeletionDialog(`${window.APP_BASE_URL}/api`, account.email);
    } catch (error) {
      console.error('Opening account deletion failed', error);
      this._qs('#configStatus').textContent = 'Could not load your account. Please try again.';
    } finally {
      this._signingOut = false;
    }
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
            .account-email {
              display: block;
              padding: 4px 0;
              color: #374151;
              font-size: 14px;
              overflow-wrap: anywhere;
              user-select: text;
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
              <label for="configEmail">Account email</label>
              <output id="configEmail" class="account-email"></output>
            </div>
            <div class="form-row">
              <label for="configPat">Personal Access Token (PAT)</label>
              <input type="password" id="configPat" placeholder="••••••••" />
            </div>
            <div class="form-row">
              <label>Remembered browsers</label>
              <button type="button" id="deviceListBtn" class="btn" ?disabled=${this._signingOut}>Refresh device list</button>
              <div id="deviceList" class="status"></div>
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
          <button id="signOutBtn" class="btn" ?disabled=${this._signingOut} @click=${this._signOut}>Sign out</button>
          <button id="deleteAccountBtn" class="btn danger" ?disabled=${this._signingOut} @click=${this._deleteAccount}>Delete account</button>
          <button id="saveConfigBtn" class="btn primary" ?disabled=${this._signingOut}>Save</button>
          <button id="closeConfigBtn" class="btn" ?disabled=${this._signingOut}>Close</button>
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
    this._qs('#deviceListBtn').addEventListener('click', async () => {
      const response = await fetch(`${window.APP_BASE_URL}/api/auth/me`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Could not load remembered browsers');
      const account = await response.json();
      const list = this._qs('#deviceList');
      list.replaceChildren();
      for (const device of account.devices) {
        const row = document.createElement('div');
        const label = document.createElement('span');
        const current = account.currentDeviceId === device.id ? ' (this browser)' : '';
        label.textContent = `${device.id.slice(0, 8)}${current} expires ${new Date(device.expires * 1000).toLocaleDateString()} `;
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.textContent = 'Revoke';
        revoke.addEventListener('click', async () => {
          const result = await fetch(`${window.APP_BASE_URL}/api/auth/devices/${device.id}`, {
            method: 'DELETE', headers: { Accept: 'application/json' },
          });
          if (!result.ok) throw new Error('Could not revoke browser');
          row.remove();
        });
        row.append(label, revoke);
        list.appendChild(row);
      }
    });
    if (saveBtn)
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        const pat = patInput.value;
        const autosaveInterval = Number(autosaveInput.value);
        // Client-side PAT format guard: disallow whitespace and require
        // printable non-space ASCII characters. Accept empty string to
        // indicate "preserve existing" behaviour.
        const PAT_RE = /^[\x21-\x7E]+$/;
        if (pat && !PAT_RE.test(pat)) {
          status.textContent = 'Invalid PAT format. Remove spaces or control characters.';
          return;
        }
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
        innerModal.close();
      });

    // Ensure the inner modal is opened after the <modal-lit> definition is available
    customElements
      .whenDefined('modal-lit')
      .then(async () => {
        const innerModal = this._getInner();
        innerModal.addEventListener('modal-close', () => this.remove());
        innerModal.open = true;
        await innerModal.updateComplete;
        patInput.focus();
      });
  }

  _overlayClick(e) {
    const innerModal = this._getInner();
    innerModal.close();
  }

  _close() {
    const innerModal = this._getInner();
    innerModal.close();
    this.remove();
  }
}

customElements.define('config-modal', ConfigModal);
