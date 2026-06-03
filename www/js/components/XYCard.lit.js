/**
 * XYCard.lit.js
 * Lightweight inline card for the XY Board plugin.
 *
 * Intentionally distinct from FeatureCard.lit.js:
 * - Static layout (no absolute positioning, no drag handles)
 * - Content adapts to whatever `detailFields` the plugin selects
 * - Emits 'xy-card-click' custom event on click so the board component
 *   can route to bus.emit(FeatureEvents.SELECTED, feature)
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { ensureArray } from '../plugins/xyBoardUtils.js';

export class XYCard extends LitElement {
  static properties = {
    feature: { type: Object },
    /** @type {string[]} field names to render as badges below the title */
    detailFields: { type: Array },
    selected: { type: Boolean },
    /** CSS color string for the left border accent */
    projectColor: { type: String },
  };

  static styles = css`
    :host {
      display: block;
    }

    .xy-card {
      position: relative;
      background: white;
      border: 1px solid #ccc;
      border-left: 4px solid var(--project-color, #ccc);
      border-radius: 6px;
      padding: 6px 8px;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      box-sizing: border-box;
      transition: box-shadow 0.15s;
    }

    .xy-card:hover {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    }

    .xy-card.selected {
      background: var(--color-selected-bg, #dceeff);
    }

    .xy-card.dirty {
      background: var(--color-dirty-bg, #ffe5c2);
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 4px;
    }

    .feature-title {
      font-weight: bold;
      font-size: 0.85em;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: break-word;
      flex: 1;
      min-width: 0;
    }

    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
    }

    .badge {
      background: #eef2ff;
      color: #1e40af;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 11px;
      white-space: nowrap;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  constructor() {
    super();
    this.feature = {};
    this.detailFields = [];
    this.selected = false;
    this.projectColor = null;
  }

  _onClick(e) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('xy-card-click', {
        detail: { feature: this.feature },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const { feature, detailFields, selected, projectColor } = this;
    const style = projectColor ? `--project-color: ${projectColor}` : '';

    // Collect badge values: for each requested field, expand arrays
    const badges = [];
    for (const field of detailFields) {
      const vals = ensureArray(feature[field]).filter((v) => v != null && v !== '');
      for (const v of vals) badges.push(String(v));
    }

    const classes = ['xy-card', selected ? 'selected' : '', feature.dirty ? 'dirty' : '']
      .filter(Boolean).join(' ');

    return html`
      <div
        class="${classes}"
        style="${style}"
        @click="${this._onClick}"
        title="${feature.title || ''}"
      >
        <div class="title-row">
          <span class="feature-title">${feature.title || '(no title)'}</span>
        </div>
        ${badges.length
          ? html`<div class="badge-row">
              ${badges.map((b) => html`<span class="badge">${b}</span>`)}
            </div>`
          : ''}
      </div>
    `;
  }
}

customElements.define('xy-card', XYCard);
