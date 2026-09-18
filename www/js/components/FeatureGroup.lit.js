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
 *   group-drag-preview    { group, clientX, clientY, deltaX, deltaY } — live drag position
 *   group-drag-end        { group, clientX, clientY, deltaX, deltaY } — drag released
 */

import { LitElement, html, css } from '../vendor/lit.js';
import { getTimelineMonths, TIMELINE_CONFIG } from './Timeline.lit.js';
import { addDays, formatDate, parseDate } from './util.js';

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
    _dragDx:      { state: true },
    _dragDy:      { state: true },
    _dragDeltaDays: { state: true },
    _previewStart: { state: true },
    _previewEnd:   { state: true },
  };

  constructor() {
    super();
    this.group = null;
    this.start = null;
    this.end = null;
    this.featureCount = 0;
    this.collapsed = false;
    this.depth = 0;
    this._dragStart = null;
    this._dragging = false;
    this._dragThreshold = 6;
    this._activePointerId = null;
    this._dragDx = 0;
    this._dragDy = 0;
    this._dragDeltaDays = 0;
    this._previewStart = null;
    this._previewEnd = null;
    this._dragAxis = null;
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
      cursor: grab;
      user-select: none;
      --drag-dx: 0px;
      --drag-dy: 0px;
      --drag-scale: 1;
      transition: filter 120ms ease;
      box-shadow: 0 4px 10px rgba(0,0,0,0.08);
      padding: 6px 10px; /* give the pill some horizontal breathing room */
      transform: translate(var(--drag-dx), var(--drag-dy)) scaleY(var(--drag-scale));
    }

    :host([dragging]) .group-card {
      cursor: grabbing;
      filter: brightness(1.08);
      --drag-scale: 1;
      z-index: 2;
    }

    .group-card:hover {
      filter: brightness(1.12);
      --drag-scale: 1.04;
    }

    .group-card:active {
      --drag-scale: 0.97;
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

    .delta {
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 0.62rem;
      background: rgba(0, 0, 0, 0.22);
      color: #fff;
      letter-spacing: 0.02em;
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

  _dateFromLeftPx(leftPx, months) {
    if (!months || months.length === 0) return new Date();
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    const relative = leftPx / monthWidth;
    let monthIndex = Math.floor(relative);
    let fraction = relative - monthIndex;
    if (monthIndex < 0) {
      monthIndex = 0;
      fraction = 0;
    }
    if (monthIndex >= months.length) {
      monthIndex = months.length - 1;
      fraction = 0.999;
    }

    const monthStart = months[monthIndex];
    const daysInMonth = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0
    ).getDate();
    let dayOffset = Math.round(fraction * (daysInMonth - 1));
    if (dayOffset < 0) dayOffset = 0;
    if (dayOffset > daysInMonth - 1) dayOffset = daysInMonth - 1;
    return new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + dayOffset);
  }

  _updateDragPreview(dx, dy) {
    if (this._dragAxis === 'horizontal') {
      this._dragDx = dx;
      this._dragDy = 0;
    } else if (this._dragAxis === 'vertical') {
      this._dragDx = 0;
      this._dragDy = dy;
    } else {
      this._dragDx = dx;
      this._dragDy = dy;
    }

    const months = getTimelineMonths();
    const parsedLeft = Number.parseFloat(this.style.left);
    const leftPx = Number.isNaN(parsedLeft) ? 0 : parsedLeft;
    const oldDate = this._dateFromLeftPx(leftPx, months);
    const newDate = this._dateFromLeftPx(Math.max(0, leftPx + this._dragDx), months);
    const deltaDays = Math.round((newDate.getTime() - oldDate.getTime()) / (1000 * 60 * 60 * 24));
    this._dragDeltaDays = deltaDays;

    if (this.start && this.end) {
      const previewStart = addDays(parseDate(this.start), deltaDays);
      const previewEnd = addDays(parseDate(this.end), deltaDays);
      this._previewStart = formatDate(previewStart);
      this._previewEnd = formatDate(previewEnd);
    } else {
      this._previewStart = null;
      this._previewEnd = null;
    }
  }

  _clearDragPreview() {
    this._dragDx = 0;
    this._dragDy = 0;
    this._dragDeltaDays = 0;
    this._previewStart = null;
    this._previewEnd = null;
    this._dragAxis = null;
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

  _onPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this._dragStart = { x: e.clientX, y: e.clientY };
    this._dragging = false;
    this._dragAxis = null;
    this._activePointerId = e.pointerId;
    const target = e.currentTarget;
    if (target && typeof target.setPointerCapture === 'function') {
      target.setPointerCapture(e.pointerId);
    }
    this._clearDragPreview();
    this.toggleAttribute('dragging', false);
  }

  _onPointerMove(e) {
    if (!this._dragStart) return;
    if (this._activePointerId !== null && e.pointerId !== this._activePointerId) return;
    const dx = e.clientX - this._dragStart.x;
    const dy = e.clientY - this._dragStart.y;
    const moved = Math.abs(dx) >= this._dragThreshold || Math.abs(dy) >= this._dragThreshold;
    if (!moved && !this._dragging) return;

    if (!this._dragging) {
      this._dragging = true;
      this.toggleAttribute('dragging', true);
      this._dragAxis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
    }

    this._updateDragPreview(dx, dy);
    const lockedDx = this._dragAxis === 'vertical' ? 0 : dx;
    const lockedDy = this._dragAxis === 'horizontal' ? 0 : dy;

    this.dispatchEvent(new CustomEvent('group-drag-preview', {
      detail: {
        group: this.group,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: lockedDx,
        deltaY: lockedDy,
        axis: this._dragAxis,
      },
      bubbles: true,
      composed: true,
    }));
  }

  _onPointerUp(e) {
    if (!this._dragStart) return;
    if (this._activePointerId !== null && e.pointerId !== this._activePointerId) return;

    const target = e.currentTarget;
    if (target && typeof target.releasePointerCapture === 'function') {
      try {
        target.releasePointerCapture(e.pointerId);
      } catch (_err) {
        void _err;
      }
    }

    if (this._dragging) {
      const dx = e.clientX - this._dragStart.x;
      const dy = e.clientY - this._dragStart.y;
      const lockedDx = this._dragAxis === 'vertical' ? 0 : dx;
      const lockedDy = this._dragAxis === 'horizontal' ? 0 : dy;
      const axis = this._dragAxis;
      this._dragging = false;
      this.toggleAttribute('dragging', false);
      this._dragStart = null;
      this._activePointerId = null;
      this._clearDragPreview();
      this.dispatchEvent(new CustomEvent('group-drag-end', {
        detail: {
          group: this.group,
          clientX: e.clientX,
          clientY: e.clientY,
          deltaX: lockedDx,
          deltaY: lockedDy,
          axis,
        },
        bubbles: true,
        composed: true,
      }));
      return;
    }

    this._dragStart = null;
    this._activePointerId = null;
    this._clearDragPreview();
    this._onToggle(e);
  }

  _onPointerCancel() {
    this._dragStart = null;
    this._dragging = false;
    this._activePointerId = null;
    this.toggleAttribute('dragging', false);
    this._clearDragPreview();
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

    const rangeStart = this._previewStart || this.start;
    const rangeEnd = this._previewEnd || this.end;
    const dateSpan = (rangeStart && rangeEnd)
      ? `${this._fmtDate(rangeStart)} \u2013 ${this._fmtDate(rangeEnd)}`
      : '';
    const deltaSign = this._dragDeltaDays > 0 ? '+' : '';
    const deltaText = `${deltaSign}${this._dragDeltaDays}d`;

    return html`
      <div
        class="group-card"
        part="group-card"
        style="background:${bg}; border:${border}; font-size:${depth > 0 ? '0.72rem' : '0.78rem'}; --drag-dx:${this._dragDx}px; --drag-dy:${this._dragDy}px;"
        @pointerdown=${this._onPointerDown}
        @pointermove=${this._onPointerMove}
        @pointerup=${this._onPointerUp}
        @pointercancel=${this._onPointerCancel}
        @lostpointercapture=${this._onPointerCancel}
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
        ${dateSpan
          ? html`<span class="dates">${dateSpan}${this._dragging ? html`<span class="delta">${deltaText}</span>` : ''}</span>`
          : ''}
      </div>
    `;
  }
}

customElements.define('feature-group', FeatureGroup);
