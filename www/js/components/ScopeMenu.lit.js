import { LitElement, html, css } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents, FilterEvents, ProjectEvents, TeamEvents } from '../core/EventRegistry.js';

const SCOPE_OPTIONS = [
  ['parent', 'Ancestors', '↑'],
  ['child', 'Descendant work', '↓'],
  ['dependency', 'Dependencies', '↔'],
  ['otherAllocations', 'Other work by participating teams', '●'],
];

export class ScopeMenuLit extends LitElement {
  static properties = {
    context: { type: Object },
    optionCounts: { type: Object },
  };

  static styles = css`
    :host { display: block; }
    .menu-popover { background: var(--color-sidebar-bg); color: var(--color-sidebar-text); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); font-size: 13px; min-width: 320px; padding: 12px; }
    .menu-title { font-size: 13px; font-weight: 700; }
    .menu-description { color: rgba(255, 255, 255, 0.72); font-size: 12px; margin-top: 4px; }
    .scope-options { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
    .scope-option { align-items: center; background: transparent; border: 1px solid transparent; border-radius: 4px; color: inherit; cursor: pointer; display: grid; font: inherit; grid-template-columns: 22px 1fr auto; gap: 8px; min-height: 32px; padding: 6px 8px; text-align: left; width: 100%; }
    .scope-option:hover { background: rgba(255, 255, 255, 0.1); }
    .scope-option.active { background: rgb(55, 85, 130); border-color: #5481e6; }
    .scope-icon { color: #8ec8ff; font-size: 14px; text-align: center; }
    .scope-count { color: rgba(255, 255, 255, 0.78); font-size: 12px; font-weight: 700; }
  `;

  constructor() {
    super();
    this.context = { parent: false, child: false, dependency: false, otherAllocations: false };
    this.optionCounts = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncScope = () => {
      this.context = sel.view.getContext();
      this.optionCounts = sel.scope.getContextOptionCounts();
    };
    [FeatureEvents.UPDATED, FilterEvents.CHANGED, ProjectEvents.CHANGED, TeamEvents.CHANGED].forEach((event) =>
      bus.on(event, this._syncScope)
    );
    this._syncScope();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._syncScope) {
      [FeatureEvents.UPDATED, FilterEvents.CHANGED, ProjectEvents.CHANGED, TeamEvents.CHANGED].forEach((event) =>
        bus.off(event, this._syncScope)
      );
    }
  }

  _toggleContext(option) {
    const next = { ...this.context, [option]: !this.context[option] };
    cmd.view.setContext(next);
    this._syncScope();
  }

  render() {
    return html`
      <div class="menu-popover">
        <div class="menu-title">Scope</div>
        <div class="menu-description">Include related work with the selected base plans</div>
        <div class="scope-options">
          ${SCOPE_OPTIONS.map(([key, label, icon]) => html`
            <button class="scope-option ${this.context[key] ? 'active' : ''}" type="button"
              title="${this.context[key] ? 'Disabling removes' : 'Enabling adds'} ${this.optionCounts[key]} display-eligible tasks before team focus; shared tasks are not counted twice"
              aria-pressed=${this.context[key] ? 'true' : 'false'} @click=${() => this._toggleContext(key)}>
              <span class="scope-icon" aria-hidden="true">${icon}</span>
              <span>${label}</span>
              <span class="scope-count">${this.context[key] ? '-' : '+'}${this.optionCounts[key]}</span>
            </button>
          `)}
        </div>
      </div>
    `;
  }
}

customElements.define('scope-menu', ScopeMenuLit);