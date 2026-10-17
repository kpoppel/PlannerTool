import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';
import { getDocsUrl } from '../services/docsUrl.js';

export class OnboardingModal extends LitElement {
  static properties = { open: { type: Boolean } };

  static styles = css`
    :host {
      display: contents;
    }
    iframe { display: block; width: min(80vw, 900px); height: 75vh; border: 0; }
    .modal-footer { display: flex; justify-content: flex-end; }
  `;

  constructor() {
    super();
    this.open = false;
    this._onModalClose = this._onModalClose.bind(this);
  }

  firstUpdated() {
    this.addEventListener('modal-close', this._onModalClose);
    // open inner modal after render
    const inner = this.renderRoot.querySelector('modal-lit');
    if (inner) inner.open = true;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('modal-close', this._onModalClose);
  }

  _onModalClose() {
    this.remove();
  }

  _close() {
    const inner = this.renderRoot.querySelector('modal-lit');
    if (inner) inner.close();
    else this.remove();
  }

  render() {
    return html`
      <modal-lit wide>
        <div slot="header"><h3>About PlannerTool</h3></div>
        <iframe title="About PlannerTool and enrollment"
          src=${`${getDocsUrl('onboarding/index.html')}?embedded=1`}></iframe>
        <div slot="footer" class="modal-footer">
          <button @click=${this._close}>Close</button>
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('onboarding-modal', OnboardingModal);
