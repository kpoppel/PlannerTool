import { LitElement, html } from '../vendor/lit.js';
import { AuthDialog } from './AuthDialog.lit.js';
import { RestProviderBase } from '../services/RestProviderBase.js';

export class SetPat extends LitElement {
  static properties = {
    busy: { type: Boolean },
    error: { type: String },
    email: { type: String },
  };

  static styles = AuthDialog.styles;

  constructor() {
    super();
    this.busy = false;
    this.error = '';
    this.email = '';
    this.apiBase = '/api';
    this.reason = 'pat_required';
    this.provider = new RestProviderBase({
      defaultCredentials: 'same-origin', baseUrlProvider: () => '',
    });
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.reason === 'pat_invalid') this.error = 'Your Azure DevOps PAT is invalid or expired.';
    this.ready = this._loadAccount();
  }

  async _loadAccount() {
    const result = await this.provider._fetchJson(this.apiBase + '/auth/me');
    if (result.ok) this.email = result.data.email;
    else this.error = 'Could not load your account. Try again.';
  }

  async _onSave(event) {
    event.preventDefault();
    if (this.busy || this.email === '') return;
    const input = this.renderRoot.querySelector('#pat');
    if (!input.reportValidity()) return;
    this.busy = true;
    this.error = '';
    try {
      const result = await this.provider._fetchJson(this.apiBase + '/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.email, pat: input.value }),
      });
      if (!result.ok) {
        this.error = result.error.code === 'pat_invalid' || result.error.code === 'invalid_pat'
          ? 'Your Azure DevOps PAT is invalid or expired.'
          : result.error.code === 'ado_organization_required'
            ? 'An Azure DevOps organization must be configured.'
            : 'Could not validate your PAT. Try again.';
        return;
      }
      input.value = '';
      this.resolve(true);
      this.remove();
    } finally {
      this.busy = false;
    }
  }

  async _onSignOut() {
    const result = await this.provider._fetchJson(this.apiBase + '/auth/logout', { method: 'POST' });
    if (result.ok) window.location.reload();
    else this.error = 'Could not sign out. Try again.';
  }

  render() {
    return html`<section role="dialog" aria-modal="true" aria-labelledby="patTitle">
      <h2 id="patTitle">Set your Azure DevOps PAT</h2>
      <p>${this.email}</p>
      <form @submit=${this._onSave}>
        <label for="pat">Azure DevOps PAT</label>
        <input id="pat" type="password" autocomplete="off" required ?disabled=${this.busy} />
        <p class="error" role="alert">${this.error}</p>
        <div class="actions">
          <button type="submit" ?disabled=${this.busy || this.email === ''}>Save PAT</button>
          ${this.email === '' ? html`<button type="button" @click=${this._loadAccount}>Retry</button>` : ''}
          <button type="button" class="link" ?disabled=${this.busy} @click=${this._onSignOut}>Sign out</button>
        </div>
      </form>
    </section>`;
  }
}

customElements.define('set-pat', SetPat);

export function showSetPat(apiBase, reason) {
  const existing = document.querySelector('set-pat');
  if (existing !== null) return existing.completion;
  const screen = document.createElement('set-pat');
  screen.apiBase = apiBase;
  screen.reason = reason;
  screen.completion = new Promise(resolve => { screen.resolve = resolve; });
  document.body.appendChild(screen);
  return screen.completion;
}