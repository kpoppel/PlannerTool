import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import './Modal.lit.js';
import { ConfigEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import { showAccountDeletionDialog } from './AuthDialog.lit.js';
import { cmd, sel } from '../application/imports.js';
import { AuthPresentationController } from './AuthStatus.lit.js';
import { getAuthentication } from '../services/authStartup.js';

class ConfigModal extends LitElement {
  static properties = {
    authentication: { attribute: false },
    open: { type: Boolean },
    _signingOut: { state: true },
    _linking: { state: true },
    _linkError: { state: true },
  };

  constructor() {
    super();
    this.authentication = getAuthentication();
    new AuthPresentationController(this);
    this.open = false;
    this._signingOut = false;
    this._linking = false;
    this._linkError = '';
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
    if (storedEmail && this.authentication === null) emailInput.value = storedEmail;
    if (this.authentication !== null && this.authentication.state.account !== null) {
      emailInput.value = this.authentication.state.account.email;
    }
    const storedAutosave = await dataService.getLocalPref('autosave.interval');
    if (storedAutosave !== undefined && autosaveInput)
      autosaveInput.value = storedAutosave;
    const letterShortcuts = await dataService.getLocalPref('keyboard.letters');
    this._qs('#letterShortcuts').checked = letterShortcuts !== false;
  }

  async _signOut() {
    if (this._signingOut) return;
    if (this.authentication !== null) {
      if (!window.confirm('Sign out of this PlannerTool instance?')) return;
      await this.authentication.logout();
      return;
    }
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

  async _onLinkAccount() {
    if (this._linking) return;
    const input = this._qs('#legacyAccountEmail');
    if (!input.reportValidity()) return;
    const email = input.value.trim();
    if (!window.confirm(`Permanently link this sign-in to ${email} and reload PlannerTool?`)) return;
    this._linking = true;
    this._linkError = '';
    try {
      await this.authentication.linkAccount(email);
    } catch (error) {
      console.error('Account linking failed', error);
      this._linkError = error.code === 'access_denied'
        ? 'This account is not eligible for linking.' : 'Could not link the account. Please try again.';
    } finally {
      this._linking = false;
    }
  }

  async _deleteAccount() {
    if (this.authentication !== null) return;
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
    const capabilities = this.authentication === null
      ? { pat: true, enrollment: true, logout: true, deleteAccount: true }
      : this.authentication.state.capabilities;
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
            .form-row input, .form-row select {
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
            .form-row .checkbox-label {
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .form-row input[type="checkbox"] {
              width: auto;
              margin: 0;
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
            ${this.authentication === null ? '' : html`
              <auth-status .authentication=${this.authentication}></auth-status>`}
            <div class="form-row">
              <label for="configEmail">Account email</label>
              <output id="configEmail" class="account-email"></output>
            </div>
            ${capabilities.linkAccount === true ? html`<div class="form-row">
              <label for="legacyAccountEmail">Existing account email</label>
              <input id="legacyAccountEmail" type="email" autocomplete="email" required
                ?disabled=${this._linking} />
              <button type="button" id="linkAccountBtn" class="btn" ?disabled=${this._linking}
                @click=${this._onLinkAccount}>${this._linking ? 'Linking...' : 'Link account'}</button>
              <div class="status" role="status">${this._linkError}</div>
            </div>` : ''}
            ${capabilities.pat ? html`<div class="form-row">
              <label for="configPat">Personal Access Token (PAT)</label>
              <input type="password" id="configPat" placeholder="••••••••" />
            </div>` : ''}
            ${capabilities.enrollment ? html`<div class="form-row">
              <label>Remembered browsers</label>
              <button type="button" id="deviceListBtn" class="btn" ?disabled=${this._signingOut}
                @click=${this._onDeviceList}>Refresh device list</button>
              <div id="deviceList" class="status"></div>
            </div>` : ''}
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
            <div class="form-row">
              <label for="allocationUnit">Allocation unit</label>
              <select id="allocationUnit">
                <option value="percent" .selected=${sel.capacity.getAllocationSettings().unit === 'percent'}>Percent</option>
                <option value="man-days" .selected=${sel.capacity.getAllocationSettings().unit === 'man-days'}>Man-days</option>
              </select>
            </div>
            <div class="form-row">
              <label class="checkbox-label" for="letterShortcuts">
                <input type="checkbox" id="letterShortcuts" checked />
                Letter shortcuts
              </label>
            </div>
            <div id="configStatus" class="status" aria-live="polite"></div>
            <button id="retryStaffingBtn" type="button"
              ?hidden=${sel.capacity.getAllocationSettings().staffing.status === 'ready'}
              @click=${async () => {
              const result = await cmd.data.refreshAllocationStaffing();
              this._qs('#retryStaffingBtn').hidden = result.ok;
              this._qs('#configStatus').textContent = result.ok ? 'Staffing loaded.'
                : 'Could not load staffing. Man-day edits and effort-preserving resizing are unavailable.';
            }}>Retry staffing</button>
          </form>
        </div>
        <div slot="footer" class="modal-footer">
          ${capabilities.logout ? html`<button id="signOutBtn" class="btn" ?disabled=${this._signingOut} @click=${this._signOut}>Sign out</button>` : ''}
          ${capabilities.deleteAccount ? html`<button id="deleteAccountBtn" class="btn danger" ?disabled=${this._signingOut} @click=${this._deleteAccount}>Delete account</button>` : ''}
          <button id="saveConfigBtn" class="btn primary" ?disabled=${this._signingOut}>Save</button>
          <button id="closeConfigBtn" class="btn" ?disabled=${this._signingOut}>Close</button>
        </div>
      </modal-lit>
    `;
  }

  updated() {
    if (this.authentication !== null) {
      const account = this.authentication.state.account;
      this._qs('#configEmail').value = account === null ? '' : account.email;
    }
  }

  async _onDeviceList() {
    if (this.authentication !== null) {
      this._qs('#deviceList').textContent = 'This browser (preview)';
      return;
    }
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
  }

  firstUpdated() {
    // Populate now that the element has rendered and inputs are present
    this._populate();

    const form = this._qs('#configForm');
    const closeBtn = this._qs('#closeConfigBtn');
    const status = this._qs('#configStatus');
    const emailInput = this._qs('#configEmail');
    const autosaveInput = this._qs('#autosaveInterval');

    const allocation = sel.capacity.getAllocationSettings();
    if (allocation.staffing.status !== 'ready') {
      status.textContent = 'Could not load staffing. Man-day edits and effort-preserving resizing are unavailable.';
    }

    // Save handler wired to Save button so the footer button can trigger form submit
    const saveBtn = this._qs('#saveConfigBtn');
    if (saveBtn)
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        const patInput = this._qs('#configPat');
        const pat = patInput === null ? '' : patInput.value;
        const autosaveInterval = Number(autosaveInput.value);
        const characterShortcutsEnabled = this._qs('#letterShortcuts').checked;
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
        await dataService.setLocalPref('keyboard.letters', characterShortcutsEnabled);
        bus.emit(ConfigEvents.UPDATED, { email, characterShortcutsEnabled });
        const allocationResult = await cmd.data.setAllocationUnit(this._qs('#allocationUnit').value);
        let patText = '';
        if (pat) patText = 'Access token updated.';
        try {
          const res = this.authentication === null
            ? await dataService.saveConfig({ email, pat }) : { ok: true };
          if (patInput !== null) patInput.value = '';
          if (res && res.ok) {
            status.textContent = 'Configuration saved. ' + patText;
          } else {
            status.textContent = 'Configuration saved locally, but server save failed.';
          }
        } catch (err) {
          status.textContent = 'Configuration saved locally, but server save failed.';
        }
        this._qs('#retryStaffingBtn').hidden = allocationResult.ok;
        if (!allocationResult.ok) {
          status.textContent += ' Could not load staffing. Man-day edits and effort-preserving resizing are unavailable.';
        }
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
        const patInput = this._qs('#configPat');
        if (patInput !== null) patInput.focus();
        else autosaveInput.focus();
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
