import { css } from '../vendor/lit.js';

/**
 * Creates styles for PluginPortfolioComponent.
 * @param {number} defaultTimelineMaxHeightVh - Default timeline max height in viewport height
 * @param {number} timelineLabelWidth - Timeline label width in pixels
 * @param {number} timelineMonthGridSpacing - Month grid spacing in pixels
 * @returns {CSSResult} The combined styles
 */
export function createPortfolioStyles(
  defaultTimelineMaxHeightVh,
  timelineLabelWidth,
  timelineMonthGridSpacing
) {
  return css`
    :host {
      display: none;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: #f0f2f5;
      color: #1e293b;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,
        sans-serif;
    }

    :host([open]) {
      display: flex;
      flex-direction: column;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      flex-shrink: 0;
      z-index: 5;
    }

    .toolbar-title {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin: 0;
    }

    .toolbar-spacer {
      flex: 1;
    }

    .close-btn {
      padding: 6px 12px;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      margin-left: 8px;
    }

    .close-btn:hover {
      background: #d32f2f;
    }

    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }

    .board-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      padding: 8px;
    }

    .board-scroll {
      flex: 1;
      overflow: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
    }

    .timeline-panel {
      position: sticky;
      top: 0;
      z-index: 35;
      display: flex;
      flex-direction: column;
      max-height: ${defaultTimelineMaxHeightVh}vh;
      border-bottom: 1px solid #d7e1ee;
      background: linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
      box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
    }

    .timeline-panel .panel-header {
      background: transparent;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    }

    .timeline-summary {
      font-size: 0.72rem;
      color: #475569;
    }

    .timeline-body {
      flex: 1;
      display: grid;
      grid-template-columns: ${timelineLabelWidth}px minmax(0, 1fr);
      align-items: start;
      min-height: 0;
      overflow: auto;
    }

    .timeline-labels {
      position: sticky;
      left: 0;
      z-index: 40;
      background: rgba(248, 251, 255, 0.96);
      border-right: 1px solid #dbe5f1;
      box-shadow: 1px 0 0 rgba(15, 23, 42, 0.03);
    }

    .timeline-label {
      display: flex;
      align-items: center;
      padding: 0 10px;
      font-size: 0.72rem;
      font-weight: 700;
      color: #334155;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-sizing: border-box;
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    }

    .timeline-label .tc-dot {
      margin-right: 8px;
      width: 8px;
      height: 8px;
      flex-shrink: 0;
    }

    .timeline-svg-wrap {
      position: relative;
      overflow: hidden;
      background:
        repeating-linear-gradient(
          to right,
          rgba(148, 163, 184, 0.07) 0,
          rgba(148, 163, 184, 0.07) 1px,
          transparent 1px,
          transparent ${timelineMonthGridSpacing}px
        ),
        #fff;
    }

    .timeline-svg {
      display: block;
      overflow: visible;
      pointer-events: auto;
    }

    .timeline-empty {
      padding: 10px 12px;
      color: #64748b;
      font-size: 0.76rem;
      font-style: italic;
      border-top: 1px solid rgba(148, 163, 184, 0.14);
    }

    .timeline-year-label {
      fill: #334155;
      font-size: 10px;
      font-weight: 700;
    }

    .timeline-month-number {
      fill: #1e293b;
      font-size: 10px;
      font-weight: 700;
      pointer-events: none;
    }

    .timeline-month-line {
      stroke: rgba(148, 163, 184, 0.42);
      stroke-width: 1;
      shape-rendering: crispEdges;
      pointer-events: none;
    }

    .timeline-year-line {
      stroke: rgba(100, 116, 139, 0.52);
      stroke-width: 1;
      shape-rendering: crispEdges;
      pointer-events: none;
    }

    .timeline-today {
      stroke: #dc2626;
      stroke-width: 1.5;
      stroke-dasharray: 5 4;
      shape-rendering: crispEdges;
      pointer-events: none;
    }

    .timeline-row-divider {
      stroke: rgba(148, 163, 184, 0.18);
      stroke-width: 1;
      shape-rendering: crispEdges;
      pointer-events: none;
    }

    .timeline-year-label {
      pointer-events: none;
    }

    .timeline-bar {
      pointer-events: visiblePainted;
    }

    table.pgrid td.sc.drop-allowed {
      box-shadow: inset 0 0 0 2px rgba(22, 163, 74, 0.55);
    }

    .pcard.dragging {
      opacity: 0.45;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
    }

    table.pgrid {
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      min-width: calc(182px + 210px * var(--state-count, 4));
      width: 100%;
    }

    .status-toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2000;
      max-width: 320px;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.94);
      color: #f8fafc;
      font-size: 0.74rem;
      font-weight: 600;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.28);
      pointer-events: none;
    }

    table.pgrid thead th {
      position: sticky;
      top: 0;
      z-index: 20;
      background: #1a2a3e;
      color: #dde4f0;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 7px 10px;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      border-bottom: 2px solid rgba(255, 255, 255, 0.06);
      white-space: nowrap;
    }

    table.pgrid thead th:first-child {
      width: 182px;
      z-index: 30;
      position: sticky;
      top: 0;
      left: 0;
      border-right: 2px solid rgba(255, 255, 255, 0.15);
      text-align: left;
    }

    .state-th-inner {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .state-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #94a3b8;
    }

    .state-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.75);
      min-width: 18px;
      height: 16px;
      border-radius: 8px;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0 4px;
      margin-left: 2px;
    }

    table.pgrid td.tc {
      position: sticky;
      left: 0;
      z-index: 10;
      background: #1a2a3e;
      color: #dde4f0;
      width: 182px;
      min-width: 182px;
      padding: 8px 10px;
      border-right: 2px solid rgba(255, 255, 255, 0.1);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      vertical-align: top;
    }

    .tc-name {
      font-size: 0.8rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .tc-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #3b82f6;
    }

    table.pgrid td.sc {
      padding: 5px;
      border-right: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      min-height: 70px;
      background: #ffffff;
    }

    .pcard {
      background: #ffffff;
      border: 1px solid #dde3ec;
      border-left: 4px solid #ccc;
      border-radius: 5px;
      padding: 6px 8px;
      margin-bottom: 5px;
      cursor: pointer;
      font-size: 0.76rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      position: relative;
      user-select: none;
      transition: box-shadow 0.14s;
    }

    .pcard.pcard-child-0 {
      margin-left: 0px;
    }

    .pcard.pcard-child-1 {
      margin-left: 16px;
      opacity: 0.95;
      background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
      border-left-width: 3px;
    }

    .pcard.pcard-child-2 {
      margin-left: 32px;
      opacity: 0.92;
      background: linear-gradient(180deg, #ffffff 0%, #f5f7fa 100%);
      border-left-width: 2px;
    }

    .pcard.pcard-child-3 {
      margin-left: 48px;
      opacity: 0.88;
      background: linear-gradient(180deg, #ffffff 0%, #f0f3f8 100%);
      border-left-width: 2px;
    }

    .pcard.pcard-child-deep {
      margin-left: 64px;
      opacity: 0.85;
      background: linear-gradient(180deg, #ffffff 0%, #ebebf0 100%);
      border-left-width: 1px;
    }

    .pcard:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14);
    }

    .pcard.selected {
      box-shadow: 0 0 0 2px #60a5fa;
    }

    .pcard.dirty::after {
      content: '';
      position: absolute;
      top: 5px;
      right: 6px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #f59e0b;
      box-shadow: 0 0 4px rgba(245, 158, 11, 0.6);
    }

    .card-id {
      display: inline-flex;
      align-items: center;
      font-size: 0.65rem;
      font-weight: 700;
      color: #64748b;
      margin-bottom: 2px;
      gap: 6px;
    }

    .card-type {
      display: inline-flex;
      width: 14px;
      height: 14px;
      align-items: center;
      justify-content: center;
    }

    .card-title {
      font-size: 0.78rem;
      font-weight: 600;
      line-height: 1.3;
      margin-bottom: 5px;
      color: #1e293b;
    }

    .card-footer {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.62rem;
      font-weight: 700;
      line-height: 1.4;
      border: 1px solid #dde3ec;
      background: #f8fafc;
      color: #334155;
    }

    .badge-proj {
      color: #ffffff;
      border-color: transparent;
    }

    .badge-pct {
      background: rgba(0, 0, 0, 0.07);
      color: #64748b;
      border-color: transparent;
    }

    .badge-multi {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fcd34d;
    }

    .badge-dates {
      background: rgba(0, 0, 0, 0.05);
      color: #64748b;
      font-weight: 500;
      font-size: 0.6rem;
      border-color: transparent;
    }

    .badge-tag {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .empty-cell {
      color: #94a3b8;
      font-size: 0.75rem;
      padding: 2px 4px;
    }

    .unalloc-panel {
      flex-shrink: 0;
      max-height: 210px;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-top: 2px solid #fcd34d;
      margin: 0 8px 8px;
      border-left: 1px solid #e2e8f0;
      border-right: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      border-radius: 0 0 8px 8px;
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: #f1f5f9;
      border-bottom: 1px solid #e2e8f0;
      cursor: pointer;
      user-select: none;
      min-height: 32px;
    }

    .panel-header:hover {
      background: #e8edf4;
    }

    .panel-title {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }

    .panel-subtitle {
      font-size: 0.72rem;
      color: #64748b;
      margin-left: 2px;
    }

    .panel-toggle {
      margin-left: auto;
      font-size: 0.72rem;
      color: #64748b;
      width: 14px;
      text-align: center;
      transition: transform 0.2s;
    }

    .panel-toggle.up {
      transform: rotate(180deg);
    }

    .unalloc-scroll {
      overflow-y: auto;
      flex: 1;
    }

    table.ugrid {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }

    table.ugrid th {
      padding: 6px 12px;
      background: #fffbeb;
      color: #92400e;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #fde68a;
      text-align: left;
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 5;
    }

    table.ugrid td {
      padding: 6px 12px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }

    table.ugrid tbody tr:hover td {
      background: #fffbeb;
      cursor: pointer;
    }

    .empty-row td {
      text-align: center;
      padding: 16px;
      color: #64748b;
      font-style: italic;
    }

    .state-cell {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .state-cell-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #94a3b8;
      flex-shrink: 0;
    }
  `;
}
