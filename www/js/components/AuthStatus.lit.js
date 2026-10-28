import { LitElement, html, css } from '../vendor/lit.js';
import { AUTH_DECISIONS } from '../services/authClient.js';
import { takeLogoutNotice } from '../services/authStartup.js';

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
  signed_in: 'Connected',
  signed_out: 'Signed out',
  session_expired: 'Your PlannerTool session has expired.',
  interaction_required: 'Azure DevOps requires reauthentication. Local work is still available.',
  access_denied: 'Azure DevOps access denied. Your local session is still active.',
  unavailable: 'Authentication service unavailable. Your local session is still active.',
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
    button { font: inherit; padding: 8px 12px; border: 1px solid #97adae;
      border-radius: 4px; box-sizing: border-box; }
    button { cursor: pointer; color: #095d59; background: #e2eeec; }
    button:disabled { cursor: wait; opacity: 0.6; }
  `;

  constructor() {
    super();
    this.authentication = null;
    this._busy = false;
    this._message = '';
    this._logoutPending = takeLogoutNotice();
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
    } catch (error) {
      if (AUTH_DECISIONS[error.code] === undefined) throw error;
      await this.authentication.handleDecision(error.code);
      this._message = this._statusMessage();
    } finally {
      this._busy = false;
    }
  }

  _statusMessage() {
    const { status, account } = this.authentication.state;
    if (status === 'unavailable' && account === null) {
      return 'Authentication service unavailable. Please try again later.';
    }
    return STATUS_MESSAGES[status];
  }

  render() {
    if (this.authentication === null) return '';
    const { status, account, capabilities } = this.authentication.state;
    const needsLogin = account === null || status === 'session_expired';
    return html`
      <p><strong>External sign-in</strong></p>
      ${this._logoutPending ? html`<p role="status">Signed out of this instance.
        Authentication service cleanup is pending; the delegated grant will expire.</p>` : ''}
      ${account === null ? '' : html`<p data-auth-account>${account.email}</p>`}
      <p role="status">${this._statusMessage()}</p>
      <div class="actions">
        ${needsLogin || capabilities.reauthenticate ? html`
          <button ?disabled=${this._busy} @click=${this._onSignIn}>${capabilities.reauthenticate
            ? 'Reauthenticate' : 'Sign in'}</button>
        ` : ''}
      </div>
      <p role="status">${this._message}</p>`;
  }
}

customElements.define('auth-status', AuthStatus);