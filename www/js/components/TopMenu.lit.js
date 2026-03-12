import { LitElement, html, css } from '../vendor/lit.js';

export class TopMenuBarLit extends LitElement {
  static styles = css`
    :host { display: block; }
    .menu-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      width: 100%;
      background: var(--color-sidebar-bg);
      color: white;
      display: flex;
      align-items: center;
      overflow: visible;
      gap: 10px;
      z-index: 1000;
      box-shadow: 0 2px 4px rgba(0,0,0,0.08);
      font-size: 13px;
      user-select: none;
    }

    .menu-left { display:flex; gap:12px; align-items:center; padding-left:12px; }
    .title-only { margin-left:6px; font-weight:700; }
    /* menu items positioned above timeline left edge (right edge of sidebar) */
    .menu-items { position: absolute; left: calc(var(--sidebar-width) + 28px); top: 4px; display:flex; gap:12px; align-items:center; white-space:nowrap; z-index: 1100; }
    .menu-right { position: absolute; right: 8px; top: 4px; display:flex; gap:12px; align-items:center; white-space:nowrap; z-index: 1100; }

    .menu-item {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px;
      padding: 6px 10px;
      color: white;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: background 160ms ease, transform 120ms ease;
      flex-shrink: 0;
    }

    .menu-item:hover { background: rgba(255,255,255,0.12); }
    .menu-item.active { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.22); }

    .icon { font-size: 14px; }

    .small-btn {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.14);
      padding: 6px 12px;
      border-radius: 6px;
      color: white;
      cursor: pointer;
      font-weight: 600;
      display: inline-flex;
      white-space: nowrap;
    }

    /* ensure buttons remain fully visible at the edge */
    .small-btn { box-shadow: 0 1px 0 rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.02); }

    /* extra safe spacing to avoid accidental overlap with other UI */
    .small-btn + .small-btn { margin-left: 4px; }

    .small-btn:hover { background: rgba(255,255,255,0.16); }

    /* Ensure main content is pushed under the menu bar visually */
    :host([offset]) ~ .main, :host ~ .main { padding-top: 40px; }

    .app-title { font-weight:700; font-size:14px; margin-right:6px; }
  `;

  render() {
    return html`
      <nav class="menu-bar" role="navigation" aria-label="Top menu">
        <div class="menu-left">
          <div class="app-title title-only">Planner Tool</div>
        </div>

        <div class="menu-items" role="menubar" aria-label="Main menus">
          <div class="menu-item" role="button" tabindex="0">View</div>
          <div class="menu-item" role="button" tabindex="0">Scenario</div>
          <div class="menu-item" role="button" tabindex="0">Plan</div>
          <div class="menu-item" role="button" tabindex="0">Team</div>
        </div>

        <div class="menu-right">
          <button class="small-btn" id="openConfigBtn" data-tour="gear" @click=${this._onConfig}>⚙️</button>
          <button class="small-btn" id="openHelpBtn" data-tour="help" @click=${this._onHelp}>❓</button>
        </div>
      </nav>
    `;
  }

  _onConfig() {
    const ev = new CustomEvent('topmenu:config', { bubbles: true, composed: true });
    this.dispatchEvent(ev);
  }

  _onHelp() {
    const ev = new CustomEvent('topmenu:help', { bubbles: true, composed: true });
    this.dispatchEvent(ev);
  }
}

customElements.define('top-menu-bar', TopMenuBarLit);
