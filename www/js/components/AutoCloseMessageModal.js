import { LitElement, html, css } from '../vendor/lit.js';

/**
 * AutoCloseMessageModal - simple message modal that closes itself after a duration
 * - Properties:
 *   - open (Boolean) - show/hide
 *   - message (String) - message text (supports basic HTML)
 *   - duration (Number) - milliseconds before auto-close (default 2000)
 * Emits `modal-close` when closed
 */
export class AutoCloseMessageModal extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    message: { type: String },
    duration: { type: Number }
  };

  static styles = css`
    :host { position: fixed; inset: 0; z-index: 10000; pointer-events: none; }
    :host([open]) { pointer-events: auto; display: block; }
    :host(:not([open])) { display: none !important; }
    .modal-overlay {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.45); z-index: 10000; padding: 12px; pointer-events: auto;
    }
    .modal-overlay[hidden] { display: none !important; }
    .modal-panel {
      background: var(--modal-bg, #2b2b33); color: var(--modal-text, #fff);
      border-radius: 8px; padding: 14px 20px; min-width: 200px; max-width: 90vw;
      box-shadow: 0 8px 30px rgba(0,0,0,0.3); text-align: center;
      font-size: 14px;
    }
    .modal-message { white-space: pre-wrap; }
  `;

  constructor(){
    super();
    this.open = false;
    this.message = '';
    this.duration = 2000;
    this._timerId = null;
    this._escHandler = (e) => { if (e.key === 'Escape') this.close(); };
  }

  updated(changed) {
    if (!changed.has('open')) return;
    const ctor = this.constructor;
    ctor._openCount = ctor._openCount || 0;
    if (this.open) {
      ctor._openCount += 1;
      document.body.classList.add('has-modal');
      window.addEventListener('keydown', this._escHandler);
      // start auto-close timer
      if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
      // Treat duration === 0 as persistent (no auto-close)
      const ms = typeof this.duration === 'number' ? this.duration : 2000;
      if (ms > 0) this._timerId = setTimeout(()=> this.close(), ms);
    } else {
      if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
      ctor._openCount = Math.max(0, ctor._openCount - 1);
      if (ctor._openCount === 0) document.body.classList.remove('has-modal');
      window.removeEventListener('keydown', this._escHandler);
    }
  }

  close(){
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true, composed: true }));
    // Remove self from DOM on next tick so listeners have a chance to handle the event
    setTimeout(()=>{
      try { if (this.parentNode) this.parentNode.removeChild(this); } catch(e) { /* ignore */ }
    }, 0);
  }

  disconnectedCallback(){
    super.disconnectedCallback && super.disconnectedCallback();
    if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
    const ctor = this.constructor;
    if (this.open) ctor._openCount = Math.max(0, (ctor._openCount || 0) - 1);
    if (!ctor._openCount) document.body.classList.remove('has-modal');
    window.removeEventListener('keydown', this._escHandler);
  }

  render(){
    return html`
      <div class="modal-overlay" ?hidden=${!this.open} @click=${() => this.close()}>
        <div class="modal-panel" role="dialog" aria-modal="true" @click=${e => e.stopPropagation()}>
          <div class="modal-message">${this.message || ''}</div>
          ${this.duration === 0 ? html`<div style="margin-top:12px"><button class="btn primary" @click=${()=>this.close()}>OK</button></div>` : ''}
        </div>
      </div>
    `;
  }
}

customElements.define('modal-autoclose', AutoCloseMessageModal);
