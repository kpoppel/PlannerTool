import { LitElement, html, css } from '../vendor/lit.js';

export class AuthPresentationController {
  constructor(host) {
    this.host = host;
    this.model = null;
    this.unsubscribe = null;
    host.addController(this);
  }

  hostConnected() {
    this.host.requestUpdate();
  }

  hostUpdate() {
    if (this.model === this.host.authentication) return;
    this.hostDisconnected();
    this.model = this.host.authentication;
    if (this.model !== null) {
      this.unsubscribe = this.model.subscribe(() => this.host.requestUpdate());
    }
  }

  hostDisconnected() {
    if (this.unsubscribe !== null) this.unsubscribe();
    this.unsubscribe = null;
    this.model = null;
  }
}

const STATUS_MESSAGES = {
  connected: 'Connected',
  signed_out: 'Signed out',
  session_expired: 'Your PlannerTool session has expired.',
  interaction_required: 'Azure DevOps requires reauthentication. Local work is still available.',
  access_denied: 'Azure DevOps access denied. Your local session is still active.',
  unavailable: 'Authentication service unavailable. Your local session is still active.',
  pat_required: 'An Azure DevOps PAT is required.',
  pat_invalid: 'Your Azure DevOps PAT is invalid or expired.',
};

export class AuthStatus extends LitElement {
  static properties = {
    authentication: { attribute: false },
    _busy: { state: true },
    _message: { state: true },
  };

  static styles = css`
    :host { display: block; color: inherit; }
    p { margin: 8px 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    button, input { font: inherit; padding: 8px 12px; border: 1px solid #97adae;
      border-radius: 4px; box-sizing: border-box; }
    button { cursor: pointer; color: #095d59; background: #e2eeec; }
    button:disabled { cursor: wait; opacity: 0.6; }
    label { display: block; margin-top: 12px; }
    input { display: block; width: 100%; margin-top: 6px; }
  `;

  constructor() {
    super();
    this.authentication = null;
    this._busy = false;
    this._message = '';
    new AuthPresentationController(this);
  }

  async _onSignIn() {
    if (this._busy) return;
    this._busy = true;
    this._message = '';
    try {
      const completed = await this.authentication.signIn();
      if (!completed) this._message = 'Sign-in cancelled.';
      this.dispatchEvent(new CustomEvent('auth-complete', { detail: completed }));
    } finally {
      this._busy = false;
    }
  }

  async _onRepairPat(event) {
    event.preventDefault();
    if (this._busy) return;
    const input = this.renderRoot.querySelector('#previewPat');
    if (!input.reportValidity()) return;
    this._busy = true;
    try {
      await this.authentication.saveSettings({ pat: input.value });
      input.value = '';
    } finally {
      this._busy = false;
    }
  }

  render() {
    if (this.authentication === null) return '';
    const { mode, status, account, capabilities } = this.authentication.state;
    const needsLogin = status === 'signed_out' || status === 'session_expired';
    return html`
      <p><strong>${mode === 'entra' ? 'Entra ID' : mode === 'pat' ? 'PAT' : 'Local'}</strong></p>
      ${account === null ? '' : html`<p data-auth-account>${account.email}</p>`}
      <p role="status">${STATUS_MESSAGES[status]}</p>
      ${capabilities.pat && (status === 'pat_required' || status === 'pat_invalid') ? html`
        <form @submit=${this._onRepairPat}>
          <label for="previewPat">Azure DevOps PAT</label>
          <input id="previewPat" type="password" autocomplete="off" required ?disabled=${this._busy}>
          <div class="actions"><button ?disabled=${this._busy}>Save PAT</button></div>
        </form>` : ''}
      <div class="actions">
        ${needsLogin || capabilities.reauthenticate ? html`
          <button ?disabled=${this._busy} @click=${this._onSignIn}>${capabilities.reauthenticate
            ? 'Reauthenticate' : capabilities.enrollment ? 'Enroll this browser' : 'Sign in with Entra ID'}</button>
        ` : ''}
      </div>
      <p role="status">${this._message}</p>`;
  }
}

customElements.define('auth-status', AuthStatus);