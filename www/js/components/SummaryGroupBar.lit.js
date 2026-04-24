/**
 * Module: SummaryGroupBar
 * Intent: Visual component for a plan-summary group bar in swimlane mode.
 *
 * Displays a summary bar that spans the date range of its member features.
 * Supports:
 *  - Inline title editing (click title to rename)
 *  - Collapse / expand to show or hide member feature cards
 *  - Drag target for adding more members (receives drop events from dragManager)
 *  - Member count badge
 */

import { LitElement, html, css } from '../vendor/lit.js';
import { summaryGroupService } from '../services/SummaryGroupService.js';

class SummaryGroupBar extends LitElement {
  static properties = {
    group: { type: Object },
    left: { type: Number },
    width: { type: Number },
    top: { type: Number },
    project: { type: Object },
    /** Mirrors the sidebar Display mode — condensed (28px) vs normal (64px) lane height */
    condensed: { type: Boolean },
    /** Whether this bar is being hovered (for drop-target highlight) */
    _dropHighlight: { type: Boolean, state: true },
    /** Whether the title <input> is visible */
    _editing: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.group = null;
    this.left = 0;
    this.width = 100;
    this.top = 0;
    this.project = null;
    this.condensed = false;
    this._dropHighlight = false;
    this._editing = false;
  }

  static styles = css`
    :host {
      display: block;
      position: absolute;
      /* Host position is set inline via style= on the element */
    }

    .group-bar {
      position: relative;
      /* Height is set via inline style from the condensed property */
      border-radius: 11px;
      display: flex;
      align-items: center;
      overflow: visible;
      cursor: pointer;
      box-sizing: border-box;
      border: 2px solid transparent;
      transition: filter 120ms ease, border-color 120ms ease;
      user-select: none;
    }

    .group-bar:hover {
      filter: brightness(1.08);
    }

    :host([data-drop-highlight]) .group-bar,
    .group-bar.drop-highlight {
      border-color: rgba(255, 255, 255, 0.7);
      filter: brightness(1.12);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
    }

    /* Bold outline distinguishing group bars from regular feature cards */
    .group-bar::before {
      content: '';
      position: absolute;
      inset: -3px;
      border-radius: 13px;
      border: 1.5px dashed rgba(255, 255, 255, 0.5);
      pointer-events: none;
    }

    .bar-fill {
      position: absolute;
      inset: 0;
      border-radius: 11px;
      opacity: 0.88;
    }

    /* Diagonal stripe overlay to signal "group" nature */
    .bar-fill::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 11px;
      background: repeating-linear-gradient(
        -45deg,
        rgba(255, 255, 255, 0.06) 0px,
        rgba(255, 255, 255, 0.06) 3px,
        transparent 3px,
        transparent 8px
      );
    }

    .bar-content {
      position: relative;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      width: 100%;
      min-width: 0;
      z-index: 1;
    }

    .collapse-btn {
      flex: 0 0 16px;
      width: 16px;
      height: 16px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.25);
      border: none;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      transition: background 120ms ease;
    }

    .collapse-btn:hover {
      background: rgba(255, 255, 255, 0.45);
    }

    .group-title {
      flex: 1 1 auto;
      font-size: 11px;
      font-weight: 700;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    }

    .title-input {
      flex: 1 1 auto;
      font-size: 11px;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 4px;
      color: #fff;
      padding: 1px 4px;
      outline: none;
      min-width: 60px;
    }

    .member-badge {
      flex: 0 0 auto;
      font-size: 9px;
      font-weight: 700;
      background: rgba(0, 0, 0, 0.25);
      color: #fff;
      border-radius: 8px;
      padding: 1px 5px;
      white-space: nowrap;
    }

    .dissolve-btn {
      flex: 0 0 14px;
      width: 14px;
      height: 14px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.15);
      border: none;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      cursor: pointer;
      padding: 0;
      opacity: 0;
      transition: opacity 120ms ease, background 120ms ease;
    }

    .group-bar:hover .dissolve-btn {
      opacity: 1;
    }

    .dissolve-btn:hover {
      background: rgba(220, 50, 50, 0.5);
    }
  `;

  _onCollapseClick(e) {
    e.stopPropagation();
    if (!this.group) return;
    summaryGroupService.setCollapsed(this.group.id, !this.group.collapsed);
  }

  _onTitleClick(e) {
    e.stopPropagation();
    this._editing = true;
    this.updateComplete.then(() => {
      this.shadowRoot?.querySelector('.title-input')?.focus();
    });
  }

  _onTitleBlur(e) {
    const val = e.target.value.trim();
    if (val && this.group) summaryGroupService.setTitle(this.group.id, val);
    this._editing = false;
  }

  _onTitleKeydown(e) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.target.blur();
    }
  }

  _onDissolveClick(e) {
    e.stopPropagation();
    if (this.group) summaryGroupService.dissolveGroup(this.group.id);
  }

  // Drag-target support: allow feature cards to be dropped onto this bar
  _onDragOver(e) {
    e.preventDefault();
    this._dropHighlight = true;
  }

  _onDragLeave() {
    this._dropHighlight = false;
  }

  _onDrop(e) {
    e.preventDefault();
    this._dropHighlight = false;
    const featureId = e.dataTransfer?.getData('text/feature-id');
    if (featureId && this.group) {
      summaryGroupService.addMember(this.group.id, featureId);
    }
  }

  render() {
    if (!this.group) return html``;
    // Use the group's own assigned color; fall back to project color if absent.
    const color = this.group.color ?? this.project?.color ?? '#4a6fa5';
    const memberCount = this.group.memberIds?.size ?? 0;
    const isCollapsed = !!this.group.collapsed;
    // Bar height tracks lane height: condensed=22px (inside 28px lane), normal=52px (inside 64px lane)
    const barHeight = this.condensed ? 22 : 52;
    const barRadius = this.condensed ? 11 : 8;

    return html`
      <div
        class="group-bar ${this._dropHighlight ? 'drop-highlight' : ''}"
        style="width: ${this.width}px; height: ${barHeight}px; border-radius: ${barRadius}px"
        @dragover=${this._onDragOver}
        @dragleave=${this._onDragLeave}
        @drop=${this._onDrop}
        role="group"
        aria-label="Summary group: ${this.group.title}"
      >
        <div class="bar-fill" style="background: ${color}"></div>
        <div class="bar-content">
          <button
            class="collapse-btn"
            title="${isCollapsed ? 'Expand group' : 'Collapse group'}"
            @click=${this._onCollapseClick}
            aria-expanded="${!isCollapsed}"
          >${isCollapsed ? '▶' : '▼'}</button>

          ${this._editing
            ? html`<input
                class="title-input"
                type="text"
                .value=${this.group.title}
                @blur=${this._onTitleBlur}
                @keydown=${this._onTitleKeydown}
                @click=${(e) => e.stopPropagation()}
              />`
            : html`<span class="group-title" @click=${this._onTitleClick} title="Click to rename">${this.group.title}</span>`
          }

          <span class="member-badge" title="${memberCount} member${memberCount !== 1 ? 's' : ''}">${memberCount}</span>

          <button
            class="dissolve-btn"
            title="Dissolve group (release members)"
            @click=${this._onDissolveClick}
          >✕</button>
        </div>
      </div>
    `;
  }
}

customElements.define('summary-group-bar', SummaryGroupBar);
