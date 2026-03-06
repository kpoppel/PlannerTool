import { LitElement, html, css } from '../../vendor/lit.js';

/**
 * PopoverBase - Base component for popover menus
 * Provides common positioning and click-outside-to-close behavior
 */
export class PopoverBase extends LitElement {
  static properties = {
    open: { type: Boolean },
    triggerElement: { type: Object }
  };

  static styles = css`
    :host {
      position: fixed;
      display: block;
      /* Ensure popovers appear above modals (empty-board modal uses 1200) */
      z-index: 1500;
    }
    .popover-container {
      background: var(--color-sidebar-bg, rgb(55, 85, 130));
      border: 1px solid rgb(35, 52, 77);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      padding: 4px;
      min-width: 200px;
      max-height: 500px;
      overflow-y: auto;
      z-index: 1500;
    }
    .popover-hidden {
      display: none;
    }
  `;

  constructor() {
    super();
    this.open = false;
    this.triggerElement = null;
    this._onDocDown = this._onDocDown.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('mousedown', this._onDocDown);
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onDocDown);
    document.removeEventListener('keydown', this._onKeyDown);
    super.disconnectedCallback();
  }

  _onDocDown(e) {
    if (!this.open) return;
    const path = (e.composedPath && e.composedPath()) || [];
    // Check if click is inside this popover or the trigger element
    if (!path.includes(this) && !path.includes(this.triggerElement)) {
      this.close();
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && this.open) {
      this.close();
    }
  }

  /**
   * Open popover relative to a trigger element
   * @param {HTMLElement} triggerElement - Element that triggered the popover
   */
  openFor(triggerElement) {
    this.triggerElement = triggerElement;
    const rect = triggerElement.getBoundingClientRect();
    
    // Position below the trigger element
    const left = rect.left + window.scrollX;
    const top = rect.bottom + window.scrollY + 4;
    
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
    this.open = true;
    this.requestUpdate();
  }

  close() {
    this.open = false;
    this.requestUpdate();
  }

  toggle(triggerElement) {
    if (this.open) {
      this.close();
    } else {
      this.openFor(triggerElement);
    }
  }

  render() {
    return html`
      <div class="popover-container ${this.open ? '' : 'popover-hidden'}">
        ${this.renderContent()}
      </div>
    `;
  }

  /**
   * Override this method in subclasses to provide popover content
   */
  renderContent() {
    return html``;
  }
}

customElements.define('popover-base', PopoverBase);
