/**
 * FeatureGroup.lit.js
 *
 * A first-class timeline component that represents a named group of features.
 * Visually similar to a FeatureCard (pill shape, positioned absolute on the
 * board) but with distinct behaviour:
 *
 *  - Position spans from the earliest start to the latest end of its children.
 *  - Cannot be dragged or resized — the content drives its position.
 *  - Click the chevron (or the pill body) to expand / collapse the group,
 *    hiding or showing its child feature cards on the board.
 *  - Right-click opens the group context menu (rename, delete).
 *  - Shows feature count badge and date range inside the pill.
 *
 * Properties:
 *   group         {object}  Group record: { id, name, color, plan_id }
 *   start         {string}  ISO date of earliest child — drives pill left edge
 *   end           {string}  ISO date of latest child   — drives pill right edge
 *   featureCount  {number}  Number of features in this group (shown as badge)
 *   collapsed     {boolean} Whether the group is collapsed
 *
 * Events (bubbles, composed):
 *   group-toggle          { groupId, collapsed }  — user toggled expand/collapse
 *   group-context-menu    { group, clientX, clientY } — right-click
 */

import { LitElement, html, css } from '../vendor/lit.js';

export class FeatureGroup extends LitElement {
  static properties = {
    group:        { type: Object },
    start:        { type: String },
    end:          { type: String },
    featureCount: { type: Number },
    collapsed:    { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.group = null;
    this.start = null;
    this.end = null;
    this.featureCount = 0;
    this.collapsed = false;
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  static styles = css`
    :host {
      display: block;
      position: absolute;   /* positioned by FeatureBoard via style= */
      /* No pointer-events on host — handled by inner .group-card */
    }

    .group-card {
      position: absolute;
      inset: 4px 0;         /* 4px vertical inset so it doesn't touch adjacent rows */
      display: flex;
      align-items: center;
      border-radius: 999px;
      overflow: hidden;
      box-sizing: border-box;
      cursor: pointer;
      user-select: none;
      transition: filter 120ms ease, transform 80ms ease;
    }

    .group-card:hover {
      filter: brightness(1.12);
      transform: scaleY(1.04);
    }

    .group-card:active {
      transform: scaleY(0.97);
    }

    /* Collapse/expand toggle chevron on the left */
    .chevron {
      flex: 0 0 auto;
      width: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.7);
      transition: transform 200ms ease;
    }

    :host([collapsed]) .chevron {
      transform: rotate(-90deg);
    }

    /* Group name */
    .group-name {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: rgba(255, 255, 255, 0.95);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Feature count badge */
    .badge {
      flex: 0 0 auto;
      padding: 1px 7px;
      margin: 0 6px 0 4px;
      border-radius: 999px;
      font-size: 0.65rem;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.18);
      color: rgba(255, 255, 255, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.22);
      white-space: nowrap;
    }

    /* Date span on the right */
    .dates {
      flex: 0 0 auto;
      padding-right: 14px;
      font-size: 0.65rem;
      color: rgba(255, 255, 255, 0.5);
      white-space: nowrap;
    }
  `;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Parse a hex colour and return rgba(…) with the given alpha. */
  _rgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return `rgba(128,128,128,${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /** Format ISO date to "MMM YY" (e.g. "Apr 26"). */
  _fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  _onToggle(e) {
    e.stopPropagation();
    this.collapsed = !this.collapsed;
    this.dispatchEvent(new CustomEvent('group-toggle', {
      detail: { groupId: this.group?.id, collapsed: this.collapsed },
      bubbles: true,
      composed: true,
    }));
  }

  _onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('group-context-menu', {
      detail: { group: this.group, clientX: e.clientX, clientY: e.clientY },
      bubbles: true,
      composed: true,
    }));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render() {
    if (!this.group) return html``;

    const color = this.group.color || '#78909c';
    const bg = this._rgba(color, 0.22);
    const border = `1.5px solid ${this._rgba(color, 0.6)}`;

    const dateSpan = (this.start && this.end)
      ? `${this._fmtDate(this.start)} – ${this._fmtDate(this.end)}`
      : '';

    return html`
      <div
        class="group-card"
        part="group-card"
        style="background:${bg}; border:${border};"
        @click=${this._onToggle}
        @contextmenu=${this._onContextMenu}
        role="button"
        aria-expanded=${!this.collapsed}
        aria-label="${this.group.name} group, ${this.featureCount} items"
        title="${this.group.name}${dateSpan ? ' · ' + dateSpan : ''}"
      >
        <span class="chevron" aria-hidden="true">▾</span>
        <span class="group-name">${this.group.name}</span>
        ${this.featureCount > 0
          ? html`<span class="badge">${this.featureCount}</span>`
          : ''}
        ${dateSpan ? html`<span class="dates">${dateSpan}</span>` : ''}
      </div>
    `;
  }
}

customElements.define('feature-group', FeatureGroup);
