// www/js/components/Modal.lit.js
// Lit 3.3.1 web component for modals

import { LitElement, html, css } from '../vendor/lit.js';

/**
 * ModalLit - configurable Lit-based modal shell
 * - Slots: `header` (optional), default (content), `footer` (optional)
 * - Attributes/properties:
 *   - `open` (Boolean) - show/hide modal
 *   - `wide` (Boolean) - use wider modal layout
 *   - `noClose` (Boolean) - hide default close button
 * - Emits `modal-close` when closed (bubbles, composed)
 */
export class ModalLit extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    wide: { type: Boolean, reflect: true },
    noClose: { type: Boolean, reflect: true }
  };

  static styles = css`
    :host { display: contents; }
    .modal-overlay {
      position: fixed; inset: 0; display: none;
      background: rgba(0,0,0,0.5);
      align-items: center; justify-content: center; z-index: 1000;
      padding: 12px;
    }
    .modal-overlay[open] { display: flex; }
    .modal {
      background: var(--modal-bg, #fff);
      border-radius: 8px; padding: 20px;
      min-width: 360px; max-width: 90vw; max-height: 90vh; overflow: auto;
      box-shadow: 0 6px 20px rgba(0,0,0,0.28);
    }
    .modal.wide { min-width: 640px; }
    ::slotted([slot="header"]) { display: block; margin-bottom: 12px; }
    .default-header { margin: 0 0 12px 0; font-size: 1.25rem; font-weight: 600; }
    .modal-content { margin-bottom: 12px; }
    .modal-footer { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
    ::slotted(.modal-footer) { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
    ::slotted(.btn) {
      padding:6px 10px;
      background:#e9e9e9;
      border:1px solid rgba(0,0,0,0.06);
      border-radius:6px;
      cursor:pointer;
      color:#333;
    }
    ::slotted(.btn:hover) { background:#e0e0e0; }
    ::slotted(.btn:focus) { outline: 2px solid rgba(92,200,255,0.12); outline-offset: 2px; }
    ::slotted(.btn.primary) {
      background: var(--color-accent, #0078d4);
      color: #fff;
      border-color: var(--color-accent, #0078d4);
    }
    ::slotted(.btn.primary:hover) { background: #2980b9; }
    button {
      padding:6px 10px;
      background:#e9e9e9;
      border:1px solid rgba(0,0,0,0.06);
      border-radius:6px;
      cursor:pointer;
      color:#333;
    }
    button:hover { background:#e0e0e0; }
    button:focus { outline: 2px solid rgba(92,200,255,0.12); outline-offset: 2px; }
    button.primary {
      background: var(--color-accent, #0078d4);
      color: #fff;
      border-color: var(--color-accent, #0078d4);
    }
    button.primary:hover { background: #2980b9; }
  `;

  constructor(){
    super();
    this.open = false;
    this.wide = false;
    this.noClose = false;
    this._escHandler = this._escHandler.bind(this);
  }

  updated(changed){
    if(changed.has('open')){
      const ctor = this.constructor;
      if(this.open){
        window.addEventListener('keydown', this._escHandler);
        ctor._openCount = (ctor._openCount || 0) + 1;
        if(ctor._openCount === 1) document.body.classList.add('has-modal');
      }
      else {
        window.removeEventListener('keydown', this._escHandler);
        ctor._openCount = Math.max(0, (ctor._openCount || 0) - 1);
        if(ctor._openCount === 0) document.body.classList.remove('has-modal');
      }
    }
  }

  _escHandler(e){ if(e.key === 'Escape') this.close(); }

  _overlayClick(e){ if(e.target.classList.contains('modal-overlay')) this.close(); }

  _stop(e){ e.stopPropagation(); }

  close(){
    if(!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent('modal-close',{bubbles:true,composed:true}));
  }

  disconnectedCallback(){
    super.disconnectedCallback && super.disconnectedCallback();
    // If the element is removed while still open, decrement the global counter
    const ctor = this.constructor;
    if(this.open){
      ctor._openCount = Math.max(0, (ctor._openCount || 0) - 1);
    }
    if(!(ctor._openCount || 0)) document.body.classList.remove('has-modal');
    window.removeEventListener('keydown', this._escHandler);
  }

  render(){
    return html`
      <div class="modal-overlay" ?open=${this.open} @click=${this._overlayClick}>
        <div class="modal ${this.wide ? 'wide' : ''}" @click=${this._stop} role="dialog" aria-modal="true">
          <slot name="header">
            <div class="default-header"><slot name="title"></slot></div>
          </slot>
          <div class="modal-content"><slot></slot></div>
          <div class="modal-footer">
            <slot name="footer">
              ${this.noClose ? html`` : html`<button class="btn" @click=${this.close}>Close</button>`}
            </slot>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('modal-lit', ModalLit);
