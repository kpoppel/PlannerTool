import { LitElement, html, css } from '../vendor/lit.js';

export class ReleaseNotes extends LitElement {
  static properties = {
    apiBase: { type: String }, releaseId: { type: String },
    busy: { type: Boolean }, error: { type: String },
  };

  static styles = css`
    :host { font: 15px Arial, sans-serif; color: #203632; }
    dialog { width: min(1120px, calc(100% - 48px)); height: 92vh; padding: 0; border: 0;
      background: white; color: inherit; border-radius: 6px; overflow: hidden;
      box-shadow: 0 16px 60px #0004; }
    dialog[open] { display: flex; flex-direction: column; }
    dialog::backdrop { background: #172b2dcc; }
    header, footer { display: flex; align-items: center; justify-content: space-between;
      gap: 16px; padding: 14px 22px; flex-shrink: 0; }
    header { border-bottom: 1px solid #d9e2df; }
    h2 { font-size: 18px; margin: 0; }
    a { color: #09695f; }
    iframe { width: 100%; flex: 1; border: 0; min-height: 0; }
    footer { border-top: 1px solid #d9e2df; }
    p { margin: 0; color: #a03425; }
    button { margin-left: auto; padding: 10px 18px; border: 0; border-radius: 4px;
      color: white; background: #09695f; font: inherit; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
  `;

  constructor() {
    super();
    this.busy = false;
    this.error = '';
  }

  get pageUrl() {
    return `${this.apiBase.replace(/\/api$/, '')}/static/docs/releases/${this.releaseId}/index.html`;
  }

  firstUpdated() {
    this.renderRoot.querySelector('dialog').showModal();
  }

  render() {
    return html`<dialog aria-labelledby="releaseTitle" @cancel=${(event) => event.preventDefault()}>
      <header><h2 id="releaseTitle">What's new in PlannerTool ${this.releaseId}</h2>
        <a href=${this.pageUrl} target="_blank" rel="noopener">Open full page</a></header>
      <iframe title="PlannerTool release notes" src=${this.pageUrl}></iframe>
      <footer><p role="alert">${this.error}</p>
        <button ?disabled=${this.busy} @click=${this._onContinue}>${this.busy ? 'Saving...' : 'Continue to Planner'}</button>
      </footer>
    </dialog>`;
  }

  async _onContinue() {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      const response = await fetch(`${this.apiBase}/auth/release-notes`, {
        method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseId: this.releaseId }),
      });
      if (!response.ok) throw new Error(`Release acknowledgement failed: ${response.status}`);
      this.remove();
      this.done();
    } catch (error) {
      console.error('Saving release acknowledgement failed', error);
      this.error = 'Could not save your acknowledgement. Please try again.';
    } finally {
      this.busy = false;
    }
  }
}

customElements.define('release-notes', ReleaseNotes);

export async function showReleaseNotes(apiBase) {
  const response = await fetch(`${apiBase}/auth/release-notes`, {
    credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Loading release status failed: ${response.status}`);
  const status = await response.json();
  if (status.acknowledged) return;
  const reader = document.createElement('release-notes');
  reader.apiBase = apiBase;
  reader.releaseId = status.releaseId;
  const complete = new Promise((resolve) => { reader.done = resolve; });
  document.body.appendChild(reader);
  return complete;
}