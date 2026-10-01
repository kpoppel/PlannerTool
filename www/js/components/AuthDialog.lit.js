import { LitElement, css, html } from '../vendor/lit.js';

class AuthDialog extends LitElement {
  static properties = {
    deleting: { type: Boolean },
    requiresKey: { type: Boolean },
    checkingEmail: { type: Boolean },
    error: { type: String },
    accountKey: { type: String },
    keySaved: { type: Boolean },
    accountEmail: { type: String },
    busy: { type: Boolean },
  };

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: grid;
      place-items: center;
      padding: 18px;
      box-sizing: border-box;
      background: rgba(19, 34, 39, 0.82);
      font: 16px Arial, sans-serif;
      color: #21343a;
    }
    section {
      width: min(100%, 440px);
      max-height: 90vh;
      overflow: auto;
      padding: 28px;
      box-sizing: border-box;
      border-radius: 6px;
      background: #f6f8f7;
      border-top: 5px solid #0d7974;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
    }
    h2 { margin: 0 0 20px; font-size: 22px; }
    label { display: block; margin: 16px 0 6px; font-weight: 600; font-size: 14px; }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px;
      border: 1px solid #97adae;
      border-radius: 4px;
      font: inherit;
    }
    button {
      font: inherit;
      border: 1px solid #0d7974;
      border-radius: 4px;
      padding: 10px 14px;
      cursor: pointer;
      background: #0d7974;
      color: white;
    }
    button:disabled { opacity: 0.6; cursor: wait; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 24px; }
    .link { background: transparent; border: 0; color: #095d59; padding: 4px; text-decoration: underline; }
    .error { color: #a03425; margin: 12px 0; }
    code { display: block; overflow-wrap: anywhere; padding: 12px; background: #e2eeec; user-select: all; }
    .confirm { display: flex; gap: 8px; align-items: start; font-weight: 400; }
    .confirm input { width: auto; margin: 4px 0; }
  `;

  constructor() {
    super();
    this.deleting = false;
    this.standaloneDeletion = false;
    this.requiresKey = false;
    this.checkingEmail = false;
    this._emailCheckId = 0;
    this.error = '';
    this.accountKey = '';
    this.keySaved = false;
    this.accountEmail = '';
    this.initialSetup = false;
    this.busy = false;
  }

  render() {
    if (this.accountKey) {
      return html`<section role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <h2 id="authTitle">Save your account key</h2>
        ${this.accountEmail ? html`<p>${this.accountEmail}</p>` : ''}
        <code>${this.accountKey}</code>
        <label class="confirm"><input type="checkbox" id="saved" .checked=${this.keySaved} @change=${this._onKeySavedChange} />I have saved this key. It will not be shown again.</label>
        <p class="error" role="alert">${this.error}</p>
        <div class="actions"><button ?disabled=${!this.keySaved} @click=${this._resolve}>Continue</button></div>
      </section>`;
    }
    return html`<section role="dialog" aria-modal="true" aria-labelledby="authTitle">
      <h2 id="authTitle">${this.deleting ? 'Delete account' : 'Enrollment'}</h2>
      <form @submit=${this._submit}>
        <label for="email">Email address</label>
        <input id="email" type="email" autocomplete="email" .value=${this.accountEmail} @input=${this._onEmailInput} @change=${this._checkEnrollment} ?readonly=${this.standaloneDeletion} ?disabled=${this.busy} required />
        ${!this.deleting && !this.requiresKey
          ? html`<label for="name">Real name (first enrollment)</label><input id="name" autocomplete="name" ?disabled=${this.busy} required />`
          : ''}
        ${this.requiresKey || this.deleting
          ? html`<label for="accountKey">Account key</label><input id="accountKey" type="password" autocomplete="off" ?disabled=${this.busy} required />`
          : ''}
        <p class="error" role="alert">${this.error}</p>
        <div class="actions">
          <button type="submit" ?disabled=${this.busy || this.checkingEmail}>${this.deleting ? 'Delete account' : 'Enroll'}</button>
          <button type="button" class="link" ?disabled=${this.busy} @click=${this._toggleDeletion}>${this.deleting ? 'Cancel' : 'Delete account'}</button>
        </div>
      </form>
    </section>`;
  }

  _onEmailInput() {
    this.accountEmail = this.renderRoot.querySelector('#email').value;
    this.requiresKey = false;
    this.checkingEmail = false;
    this._emailCheckId += 1;
    this.error = '';
  }

  async _checkEnrollment() {
    const input = this.renderRoot.querySelector('#email');
    if (this.deleting || !input.checkValidity()) return;
    const email = input.value.trim();
    const checkId = ++this._emailCheckId;
    this.accountEmail = email;
    this.checkingEmail = true;
    this.error = '';
    try {
      const response = await fetch(this.apiBase + '/auth/enrollment-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error(`Account lookup failed: ${response.status}`);
      const result = await response.json();
      if (checkId === this._emailCheckId) this.requiresKey = result.requiresKey;
    } catch (error) {
      if (checkId === this._emailCheckId) {
        this.error = 'Could not check account access. Check your email and try again.';
        console.error('Account lookup failed', error);
      }
    } finally {
      if (checkId === this._emailCheckId) this.checkingEmail = false;
    }
  }

  async _toggleDeletion() {
    if (this.standaloneDeletion) {
      this.remove();
      return;
    }
    this.accountEmail = this.renderRoot.querySelector('#email').value;
    this._emailCheckId += 1;
    this.checkingEmail = false;
    this.deleting = !this.deleting;
    this.error = '';
    if (!this.deleting) await this._checkEnrollment();
  }

  async _submit(event) {
    event.preventDefault();
    if (this.busy || this.checkingEmail) return;
    const email = this.renderRoot.querySelector('#email').value.trim();
    const accountKey = this.requiresKey || this.deleting
      ? this.renderRoot.querySelector('#accountKey').value.trim() : '';
    if (this.deleting && !window.confirm(`Delete ${email}, its saved views and scenarios, PAT, and access from every browser? This cannot be undone except by restoring a retained backup.`)) return;
    const name = this.requiresKey || this.deleting
      ? '' : this.renderRoot.querySelector('#name').value.trim();
    const payload = { email, name, accountKey };
    this.busy = true;
    try {
      if (this.deleting) {
        const { dataService } = await import('../services/dataService.js');
        await dataService.deleteAccount(email, accountKey);
        window.location.reload();
        return;
      }
      const response = await fetch(this.apiBase + '/auth/enroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        this.accountEmail = email;
        if (response.status === 409) this.requiresKey = true;
        this.error = response.status === 409
          ? 'Enter the current account key to enroll this browser.'
          : response.status === 401 ? 'Invalid account key. Use the latest saved key.'
          : 'Enrollment failed. Check your email and name and try again.';
        return;
      }
      const result = await response.json();
      this.accountEmail = email;
      this.initialSetup = result.initialSetup === true;
      this.accountKey = result.accountKey;
      const raw = localStorage.getItem('az_planner:user_prefs:v1');
      const preferences = raw ? JSON.parse(raw) : {};
      preferences['user.email'] = email;
      localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify(preferences));
    } catch (error) {
      this.error = this.deleting ? error.message
        : this.accountKey ? 'Enrolled, but local preferences could not be updated. Save this key before continuing.'
        : 'Cannot contact the server. Try again.';
      console.error('Account action failed', error);
    } finally {
      this.busy = false;
    }
  }

  _onKeySavedChange(event) {
    this.keySaved = event.target.checked;
  }

  _resolve() {
    if (this.initialSetup) {
      window.location.assign(this.apiBase.replace(/\/api$/, '') + '/admin/');
      return;
    }
    this.done();
    this.remove();
  }
}

customElements.define('auth-dialog', AuthDialog);

export function showAuthDialog(apiBase) {
  const dialog = document.createElement('auth-dialog');
  dialog.apiBase = apiBase;
  document.body.appendChild(dialog);
  return new Promise((resolve) => { dialog.done = resolve; });
}

export function showAccountKeyDialog(accountKey, accountEmail) {
  const dialog = document.createElement('auth-dialog');
  dialog.accountKey = accountKey;
  dialog.accountEmail = accountEmail;
  const saved = new Promise((resolve) => { dialog.done = resolve; });
  document.body.appendChild(dialog);
  return saved;
}

export function showAccountDeletionDialog(apiBase, accountEmail) {
  const dialog = document.createElement('auth-dialog');
  dialog.apiBase = apiBase;
  dialog.accountEmail = accountEmail;
  dialog.deleting = true;
  dialog.standaloneDeletion = true;
  dialog.done = () => {};
  document.body.appendChild(dialog);
  return dialog;
}