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
    /**
     * Nesting depth (0 = top-level group, 1 = sub-group, etc.).
     * Used for visual indentation: sub-groups are visually inset on the
     * left and rendered slightly smaller so hierarchy is immediately clear.
     */
    depth:        { type: Number },
  };

  constructor() {
    super();
    this.group = null;
    this.start = null;
    this.end = null;
    this.featureCount = 0;
    this.collapsed = false;
    this.depth = 0;
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
      box-shadow: 0 4px 10px rgba(0,0,0,0.08);
      padding: 6px 10px; /* give the pill some horizontal breathing room */
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
      font-size: 12px;
      color: #ffffff;
      transition: transform 200ms ease;
      text-shadow: 0 1px 0 rgba(0,0,0,0.22);
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
      color: #ffffff;
      text-shadow: 0 1px 0 rgba(0,0,0,0.25);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Feature count badge */
    .badge {
      flex: 0 0 auto;
      padding: 2px 8px;
      margin: 0 6px 0 6px;
      border-radius: 999px;
      font-size: 0.65rem;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.18);
      white-space: nowrap;
      text-shadow: 0 1px 0 rgba(0,0,0,0.18);
    }

    /* Date span on the right */
    .dates {
      flex: 0 0 auto;
      padding-right: 14px;
      font-size: 0.65rem;
      color: rgba(255, 255, 255, 0.95);
      white-space: nowrap;
      text-shadow: 0 1px 0 rgba(0,0,0,0.18);
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
    const depth = this.depth ?? 0;
    // Sub-groups use a semi-transparent fill so they're visually subordinate.
    // Top-level groups are fully opaque.
    const bg = depth === 0 ? color : this._rgba(color, 0.72);
    const border = `1.5px solid ${this._rgba(color, 0.9)}`;

    const dateSpan = (this.start && this.end)
      ? `${this._fmtDate(this.start)} \u2013 ${this._fmtDate(this.end)}`
      : '';

    return html`
      <div
        class="group-card"
        part="group-card"
        style="background:${bg}; border:${border}; font-size:${depth > 0 ? '0.72rem' : '0.78rem'};"
        @click=${this._onToggle}
        @contextmenu=${this._onContextMenu}
        role="button"
        aria-expanded=${!this.collapsed}
        aria-label="${this.group.name} group, ${this.featureCount} items"
        title="${this.group.name}${dateSpan ? ' \u00b7 ' + dateSpan : ''}"
      >
        <span class="chevron" aria-hidden="true">\u25be</span>
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
