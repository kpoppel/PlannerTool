// www/js/components/Modal.lit.js
// Lit 3.3.1 web component for modals

import { LitElement, html, css } from '../vendor/lit.js';

/**
 * SpinnerModal - Modal with a spinner and configurable message
 * - Slots: `header` (optional), default (content), `footer` (optional)
 * - Attributes/properties:
 *   - `open` (Boolean) - show/hide modal
 *   - `wide` (Boolean) - use wider modal layout
 *   - `noClose` (Boolean) - hide default close button
 * - Emits `modal-close` when closed (bubbles, composed)
 */
export class SpinnerModal extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    wide: { type: Boolean, reflect: true },
    noClose: { type: Boolean, reflect: true },
    message: { type: String }
  };

  static styles = css`
/* Loading Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0,0,0,0.4);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-content {
  background: #fff;
  padding: 2em 3em;
  border-radius: 8px;
  box-shadow: 0 2px 16px rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #eee;
  border-top: 4px solid #0078d4;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1em;
}
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
#loading-label {
  font-size: 1.2em;
  color: #333;
  margin-top: 0.5em;
  text-align: center;
}
/* Ensure hidden attribute actually hides overlay even with author styles */
.modal-overlay[hidden]{ display: none !important; }
  `;

  constructor(){
    super();
    this.open = false;
    this.message = 'Loading';
    this._escHandler = (e) => { if (e.key === 'Escape') this.close(); };
  }

  updated(changed){
    const ctor = this.constructor;
    if (!changed.has('open')) return;
    ctor._openCount = ctor._openCount || 0;
    if (this.open) {
      ctor._openCount += 1;
      document.body.classList.add('has-modal');
      window.addEventListener('keydown', this._escHandler);
    } else {
      ctor._openCount = Math.max(0, ctor._openCount - 1);
      if (ctor._openCount === 0) document.body.classList.remove('has-modal');
      window.removeEventListener('keydown', this._escHandler);
    }
  }

  close(){
    if(!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent('modal-close',{bubbles:true,composed:true}));
  }

  disconnectedCallback(){
    super.disconnectedCallback && super.disconnectedCallback();
    const ctor = this.constructor;
    if (this.open) ctor._openCount = Math.max(0, (ctor._openCount || 0) - 1);
    if (!ctor._openCount) document.body.classList.remove('has-modal');
    window.removeEventListener('keydown', this._escHandler);
  }

  render(){
    return html`
        <div id="loading-modal" class="modal-overlay" ?hidden="${!this.open}">
            <div class="modal-content" role="dialog" aria-modal="true" aria-label="Loading">
              <div class="spinner" aria-hidden="true"></div>
              <div id="loading-label">${this.message}</div>
            </div>
        </div>
    `;
  }
}

customElements.define('modal-spinner', SpinnerModal);
