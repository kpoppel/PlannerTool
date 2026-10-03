import { LitElement, html, css } from '../vendor/lit.js';
import { reconciliation } from './reconciliation/runtime.js';
import { CATEGORIES, statusText } from './reconciliation/presentation.js';
import { openReconciliationReview } from './reconciliation/ReconciliationReview.lit.js';

export class PluginReconciliationComponent extends LitElement {
  static properties = {
    snapshot: { state: true },
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      color: var(--color-sidebar-text, white);
      font-family: inherit;
    }
    button {
      font: inherit;
      color: inherit;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 4px;
      min-height: 36px;
      padding: 8px 10px;
      cursor: pointer;
      text-align: left;
    }
    button:focus-visible { outline: 2px solid #8ec8ff; outline-offset: 2px; }
    button:disabled { opacity: 0.55; cursor: default; }
    button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
    .summaries { display: grid; gap: 6px; }
    .category { display: flex; width: 100%; align-items: center; justify-content: space-between; }
    .count { min-width: 3ch; text-align: right; font-variant-numeric: tabular-nums; }
    p { font-size: 12px; margin: 0 0 8px; overflow-wrap: anywhere; }
    .marker-toggle { display: flex; align-items: center; gap: 8px; margin-top: 12px;
      font-size: 12px; cursor: pointer; }
    .marker-toggle input { flex-shrink: 0; margin: 0; }
  `;

  constructor() {
    super();
    this.snapshot = reconciliation.snapshot;
  }

  connectedCallback() {
    super.connectedCallback();
    this.snapshot = reconciliation.snapshot;
    this._unsubscribe = reconciliation.subscribe((snapshot) => { this.snapshot = snapshot; });
  }

  disconnectedCallback() {
    this._unsubscribe();
    super.disconnectedCallback();
  }

  _onReview(category = 'all', selectedId = null) {
    this.dispatchEvent(new CustomEvent('menu-close', { bubbles: true, composed: true }));
    openReconciliationReview(category, selectedId);
  }

  render() {
    const snapshot = this.snapshot;
    return html`
      ${snapshot.status !== 'ready' ? html`<p role="status">${statusText(snapshot)}</p>` : ''}
      <div class="summaries" role="group" aria-label="Deviation counts">
        ${CATEGORIES.map((category) => {
          const count = snapshot.groups.filter((group) => group.category === category.id).length;
          return html`<button class="category" data-category=${category.id}
            ?disabled=${snapshot.status !== 'ready' || count === 0}
            @click=${() => this._onReview(category.id)}>
            <span>${category.label}</span>
            <strong class="count">${count}</strong>
          </button>`;
        })}
      </div>
      <label class="marker-toggle">
        <input type="checkbox" .checked=${snapshot.markersVisible}
          @change=${(event) => reconciliation.setMarkersVisible(event.target.checked)}>
        <span>Show markers on feature cards</span>
      </label>
    `;
  }
}

customElements.define('plugin-reconciliation-content', PluginReconciliationComponent);