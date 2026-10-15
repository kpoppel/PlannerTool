import { css } from '../../vendor/lit.js';

export const SIDEBAR_STYLES = css`
    :host {
      display: block;
    }
    /* Keep component-specific small tweaks; main styles come from www/css/main.css */
    //  .chip { display:flex; gap:8px; align-items:center; padding:6px; border-radius:6px; cursor:pointer; }
    //  .chip.active { opacity: 0.95; }
    //  .color-dot { width:16px; height:16px; border-radius:4px; flex:0 0 auto; }
    //  .chip-badge { padding:2px 6px; border-radius:10px; font-size:12px; background: rgba(255,255,255,0.06); }
    /* Make the last two columns square so icons can be square boxes and match main.css */
    .counts-header {
      display: grid;
      grid-template-columns: 24px 28px 1fr 58px 31px;
      align-items: center;
      gap: 8px;
      //margin-bottom:4px;
      color: #ddd;
      //min-height:32px;
    }
    /* Use a compact 16x16 icon container and center it within the grid cell. */
    .type-icon {
      display: inline-flex;
      align-items: center;
    }
    .type-icon.epic {
      color: #ffcf33;
      margin-left: 30px;
    }
    /* Let the svg fill the 16x16 container */
    .type-icon svg {
      width: 16px;
      height: 16px;
      display: block;
    }
    .group-title {
      font-weight: 700;
      font-size: 12px;
      margin: 6px 0 10px;
      color: #3b3b3b;
    }
    .plans-group .sidebar-list {
      margin-top: 4px;
      margin-bottom: 4px;
    }
    .divider {
      border-top: 1px dashed rgba(255, 255, 255, 1);
      margin: 10px 0;
      border-radius: 2px;
      height: 0;
    }
    /* Sidebar container styles (migrated from www/css/main.css) */
    .sidebar {
      width: var(--sidebar-width);
      min-width: var(--sidebar-width);
      max-width: var(--sidebar-width);
      background: var(--color-sidebar-bg);
      color: var(--color-sidebar-text);
      padding: 0px 6px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      position: fixed;
      top: 40px;
      left: 0;
      z-index: var(--z-sidebar);
      font-size: 14px;
      overflow: hidden;
      box-sizing: border-box;
      height: calc(100vh - 40px - var(--app-footer-height, 64px));
      word-wrap: break-word;
      word-break: break-word;
    }

    /* Make content area scrollable and fill available space */
    .sidebar-content {
      flex: 1;
      overflow: hidden auto;
      padding-bottom: 0;
      min-height: 0;
      width: 100%;
    }

    .sidebar h2 {
      margin: 0 0 8px;
      font-size: 1.1rem;
      word-wrap: break-word;
    }
    .sidebar-section {
      overflow: hidden;
    }
    .sidebar-section h3 {
      margin: 0 0 6px;
      font-size: 0.93rem;
      word-wrap: break-word;
    }
    .sidebar-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .sidebar-list-item {
      display: flex;
      align-items: center;
    }
    .sidebar-section-collapsed {
      display: none;
    }
    .sidebar-section-header-collapsible {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 1rem;
    }
    .sidebar-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 1rem;
    }
    .sidebar-chevron {
      font-size: 1.1em;
      margin-right: 4px;
      cursor: pointer;
      transition: transform 0.15s;
    }
    .sidebar-title {
      flex: 1;
    }
    /* Chips, list and control styles (migrated from main.css) */
    .chip-group {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 8px 0;
    }
    .chip-group .group-label {
      width: 100%;
      font-weight: 600;
      font-size: 0.85rem;
      opacity: 0.9;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: var(--color-sidebar-text);
      background: rgba(255, 255, 255, 0.08);
      cursor: pointer;
      font-size: 0.8rem;
      line-height: 1;
      user-select: none;
      transition:
        background 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
    }
    .chip:hover {
      background: rgba(255, 255, 255, 0.14);
    }
    /* Active state: match when class is present or when ARIA attributes indicate pressed/checked */
    .chip.active,
    .chip[aria-pressed='true'],
    .chip[aria-checked='true'] {
      background: #fff;
      color: #23344d;
      border-color: #fff;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.06) inset,
        0 1px 3px rgba(0, 0, 0, 0.06);
      //font-weight:600;
    }
    /* Make inactive chips slightly muted so active state stands out */
    .chip:not(.active):not([aria-pressed='true']):not([aria-checked='true']) {
      opacity: 0.95;
    }
    .chip-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 18px;
      border-radius: 9px;
      font-size: 0.7rem;
      font-weight: 700;
      background: rgba(0, 0, 0, 0.12);
      color: #fff;
    }
    .chip.active .chip-badge {
      background: #23344d;
      color: #fff;
    }
    .chip:focus-visible {
      outline: 2px solid #5cc8ff;
      outline-offset: 2px;
    }

    .team-drilldown-grid {
      display: grid;
      grid-template-columns: var(--team-columns);
      gap: 4px;
      align-items: center;
      overflow-x: auto;
    }
    .team-counts-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 24px;
      background: transparent;
      border: 0;
      border-radius: 4px;
      color: var(--color-sidebar-text);
      font: inherit;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .team-counts-toggle:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    .team-counts-toggle:focus-visible {
      outline: 2px solid #5cc8ff;
      outline-offset: 2px;
    }
    [aria-expanded='true'] > .counts-chevron {
      transform: rotate(90deg);
    }
    .team-drilldown-header {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      color: var(--color-sidebar-text);
      opacity: 0.9;
      min-height: 22px;
    }
    .team-drilldown-header .type-icon,
    .team-drilldown-row .chip-badge {
      justify-self: center;
    }
    .team-drilldown-header .type-icon svg {
      width: 16px;
      height: 16px;
      display: block;
    }
    #team-drilldown-list > .sidebar-list-item {
      display: grid;
      grid-template-columns: subgrid;
    }
    .team-drilldown-row {
      grid-column: 1 / -1;
      width: 100%;
      min-width: 0;
      position: relative;
      padding: 0;
      border-radius: 6px;
      display: grid;
      grid-template-columns: subgrid;
      gap: 4px;
      align-items: stretch;
      overflow: hidden;
    }
    .sidebar-chip.team-drilldown-row {
      display: grid;
      align-items: stretch;
      padding: 0;
    }
    .sidebar-chip.team-drilldown-row .team-name-col {
      font-weight: 600;
      padding: 6px 4px;
      align-self: center;
      text-align: left;
    }
    .team-drilldown-row .color-dot {
      width: 14px;
      height: auto;
      border-radius: 6px 0 0 6px;
      align-self: stretch;
      cursor: pointer;
    }
    .team-drilldown-row .team-name-col {
      min-width: 0;
      padding: 6px 4px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      line-height: 1.1;
      overflow-wrap: anywhere;
      font-weight: 400;
      overflow: hidden;
    }
    .team-drilldown-row .team-name-col > span:first-child {
      width: 100%;
    }
    .team-drilldown-grid:has(.team-drilldown-header) .team-name-col > span:first-child {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .team-drilldown-row .team-name-col small {
      opacity: 0.8;
      font-size: 0.68rem;
      font-weight: 400;
    }
    .team-drilldown-row.active {
      background: rgb(55, 85, 130);
      border-color: transparent;
      color: var(--color-sidebar-text);
    }
    .team-drilldown-row .chip-badge {
      width: 32px;
      height: 20px;
      align-self: center;
      border-radius: 4px;
      background: transparent;
      font-size: 0.75rem;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
      color: var(--color-sidebar-text);
      opacity: 0.75;
    }
    .team-drilldown-row .chip-badge.has-count {
      background: rgba(0, 0, 0, 0.18);
    }

    /* Data Funnel (dataset status) */
    .dataset-status {
      background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.06) 0%,
        rgba(255, 255, 255, 0.02) 100%
      );
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
    }
    .status-title {
      font-size: 11px;
      text-transform: uppercase;
      opacity: 0.8;
      margin-bottom: 8px;
    }
    .status-flow {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
    }
    .status-number {
      font-size: 16px;
      font-weight: 800;
      color: var(--color-sidebar-text);
    }
    .status-label {
      font-size: 11px;
      opacity: 0.85;
    }
    .status-arrow {
      font-size: 14px;
      opacity: 0.6;
    }

    /* Sidebar control sections */
    .expansion-section {
      background: linear-gradient(
        135deg,
        rgba(102, 126, 234, 0.12) 0%,
        rgba(102, 126, 234, 0.03) 100%
      );
      border: 1px solid rgba(102, 126, 234, 0.2);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
      opacity: 0.95;
    }
    .section-description {
      font-size: 11px;
      opacity: 0.75;
      margin-bottom: 10px;
      line-height: 1.4;
    }
    .option-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .option-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .option-row:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.15);
    }
    .option-row.active {
      background: rgba(102, 126, 234, 0.25);
      border-color: rgba(102, 126, 234, 0.4);
    }
    .option-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .option-checkbox {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }
    .option-row.active .option-checkbox {
      background: rgba(102, 126, 234, 0.8);
      border-color: rgba(102, 126, 234, 1);
    }
    .option-checkbox::after {
      content: '✓';
      color: white;
      font-size: 11px;
      font-weight: bold;
      opacity: 0;
    }
    .option-row.active .option-checkbox::after {
      opacity: 1;
    }
    .option-count {
      font-size: 11px;
      padding: 2px 6px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      font-weight: 600;
    }
    .option-row.active .option-count {
      background: rgba(102, 126, 234, 0.4);
    }

    .option-row.disabled {
      opacity: 0.55;
      cursor: not-allowed;
      pointer-events: none;
    }

    /* Task Filters section */
    .filter-dimension {
      margin-bottom: 10px;
    }
    .filter-dimension-title {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.8;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .filter-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .filter-option {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.15s;
      font-size: 12px;
    }
    .filter-option:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .filter-option.active {
      background: rgba(102, 126, 234, 0.25);
      border-color: rgba(102, 126, 234, 0.4);
    }
    .filter-checkbox {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }
    .filter-option.active .filter-checkbox {
      background: rgba(102, 126, 234, 0.8);
      border-color: rgba(102, 126, 234, 1);
    }
    .filter-checkbox::after {
      content: '✓';
      color: white;
      font-size: 9px;
      font-weight: bold;
      opacity: 0;
    }
    .filter-option.active .filter-checkbox::after {
      opacity: 1;
    }

    /* Disabled visuals applied when external plugins set disabled maps */
    .filter-option.disabled {
      opacity: 0.2;
      cursor: not-allowed;
      pointer-events: none;
    }

    /* Segmented button groups for radio-style options */
    .segmented-group {
      display: flex;
      gap: 2px;
      background: rgba(0, 0, 0, 0.15);
      border-radius: 4px;
      padding: 2px;
    }
    .segment-btn {
      flex: 1;
      padding: 5px 8px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      color: var(--color-sidebar-text);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
      text-align: center;
    }
    .segment-btn:hover:not(.active) {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.15);
    }
    .segment-btn.active {
      background: rgba(102, 126, 234, 0.35);
      border-color: rgba(102, 126, 234, 0.5);
      color: var(--color-sidebar-text);
      font-weight: 600;
      box-shadow: 0 0 0 1px rgba(102, 126, 234, 0.3) inset;
    }
    .segment-btn:focus-visible {
      outline: 2px solid #5cc8ff;
      outline-offset: 1px;
    }
    .segment-btn:disabled,
    .segment-btn.disabled {
      opacity: 0.35;
      cursor: not-allowed;
      pointer-events: none;
    }
    .context-group {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .context-group .segment-btn {
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .team-view-mode-group {
      margin-top: 12px;
    }

    .hierarchy-fold-group { margin-top: 12px; }
    .hierarchy-fold-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .hierarchy-fold-status { font-size: 11px; opacity: 0.7; text-align: right; }
    .hierarchy-fold-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 5px; }
    .hierarchy-fold-actions .segment-btn {
      min-width: 0;
      min-height: 36px;
      padding: 4px 2px;
      font-size: 11px;
      line-height: 1.15;
      white-space: normal;
    }

    /* Sidebar-specific chips and lists */
    .sidebar-chip {
      padding: 0 8px 0 0;
      border-radius: 10px;
      background: transparent;
      border: 1px solid rgba(0, 0, 0, 0.06);
      box-sizing: border-box;
      min-height: 25px;
      overflow: hidden;
      display: flex;
      align-items: stretch;
    }
    .sidebar-chip:hover,
    .sidebar-chip.chip-hover {
      background: rgba(255, 255, 255, 0.18);
      cursor: pointer;
    }
    .sidebar-chip.active {
      background: transparent;
      border-color: transparent;
      background: rgb(55, 85, 130);
    }
    .sidebar-chip.active:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    .sidebar-list {
      list-style: none;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sidebar-list-item {
      display: block;
    }
    .sidebar-list .color-dot {
      width: 28px;
      border-radius: 6px 0 0 6px;
      display: inline-block;
      flex: 0 0 28px;
      align-self: stretch;
      cursor: pointer;
    }
    .sidebar-chip .project-name-col,
    .sidebar-chip .team-name-col {
      padding-left: 8px;
      font-weight: 600;
      font-size: 0.8rem;
      color: var(--color-sidebar-text);
    }
    .chip-badge.small {
      font-size: 0.75rem;
      min-width: 20px;
      padding: 0 6px;
    }
    .sidebar-chip .chip-badge {
      background: rgba(0, 0, 0, 0.06);
      color: var(--color-sidebar-text);
    }

    /* Toggle and list controls */
    .list-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .list-toggle-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 50px;
      height: 20px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.08);
      color: var(--color-sidebar-text);
      border-radius: 10px;
      font-size: 0.72rem;
      font-weight: 400;
      cursor: pointer;
      margin-left: 3px;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .list-toggle-btn:hover {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.4);
    }
    .list-toggle-btn:focus-visible {
      outline: 2px solid #5cc8ff;
      outline-offset: 2px;
    }

    #openConfigBtn {
      background: #f7f7f7;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      color: #333;
    }
    #openConfigBtn:hover {
      background: #eee;
    }
    #openHelpBtn {
      background: #f7f7f7;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      color: #333;
      margin-left: 8px;
    }
    #openHelpBtn:hover {
      background: #eee;
    }
    /* View options and segmented control (migrated from main.css -> viewOptions.js) */
    .view-option-section {
      margin: 12px 0;
    }
    .group-label {
      font-weight: 600;
      font-size: 0.85rem;
      opacity: 0.9;
      margin-bottom: 6px;
    }

    .segmented-control {
      display: flex;
      gap: 0;
      border-radius: 16px;
      padding: 4px;
      background: transparent;
      border: none;
      align-items: center;
    }

    .segment {
      /* Match .chip styles exactly for consistency */
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: var(--color-sidebar-text);
      background: rgba(255, 255, 255, 0.08);
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
      line-height: 1;
      user-select: none;
      transition:
        background 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease,
        border-color 120ms ease;
    }

    .segment:hover:not(.active) {
      background: rgba(255, 255, 255, 0.14);
    }
    .segment.active,
    .segment[aria-pressed='true'],
    .segment[aria-checked='true'] {
      background: #fff;
      color: #23344d;
      border-color: #fff;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.06) inset,
        0 1px 3px rgba(0, 0, 0, 0.06);
    }
    .segment.first {
      border-top-left-radius: 16px;
      border-bottom-left-radius: 16px;
    }
    .segment.last {
      border-top-right-radius: 16px;
      border-bottom-right-radius: 16px;
    }
    .segment:focus-visible {
      outline: 2px solid #5cc8ff;
      outline-offset: 2px;
      z-index: 2;
    }

    /* Accent-enabled chip variant */
    .chip-with-accent.active {
      background: #fff;
      color: #23344d;
      border-left-color: var(--chip-accent);
      border-right-color: var(--chip-accent);
      border-left-style: solid;
      border-right-style: solid;
      border-left-width: 8px;
      border-right-width: 8px;
    }
    .chip-with-accent.active .chip-badge {
      background: #23344d;
      color: #fff;
    }
    .chip-with-accent:focus-visible {
      outline-offset: 2px;
    }
    .chip-with-accent::before,
    .chip-with-accent::after {
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06) inset;
    }
    /* Scenario list styling */
    .scenario-item {
      padding: 4px 6px;
      border-radius: 6px;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      position: relative;
    }
    .scenario-item.active {
      background: rgba(255, 255, 255, 0.18);
    }
    .scenario-name {
      cursor: pointer;
      flex: 1 1 auto;
      font-weight: 600;
      font-size: 0.85rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .scenario-controls {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
    }
    .scenario-name {
      padding-right: 56px;
    }
    .scenario-btn {
      background: #f7f7f7;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 0.75rem;
      line-height: 1;
    }
    .scenario-btn:hover {
      background: #ececec;
    }
    .scenario-lock {
      font-size: 0.9rem;
      margin-right: 4px;
    }
    .scenario-menu-popover {
      position: absolute;
      background: #fff;
      color: #222;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      padding: 6px 0;
      display: flex;
      flex-direction: column;
      min-width: 160px;
      z-index: 1200;
    }
    .scenario-menu-item {
      padding: 6px 12px;
      font-size: 0.8rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .scenario-menu-item:hover {
      background: #f3f5f7;
    }
    .scenario-menu-item.disabled {
      color: #999;
      cursor: default;
    }
    .scenario-annotate-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    .scenario-annotate-table th,
    .scenario-annotate-table td {
      border: 1px solid var(--color-border);
      padding: 6px 8px;
      font-size: 0.85rem;
    }
    .scenario-annotate-table th {
      background: #f7f7f7;
      text-align: left;
    }

    /* View list styling - matching scenario styling */
    .view-item {
      padding: 4px 6px;
      border-radius: 6px;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      position: relative;
    }
    .view-item.active {
      background: rgba(255, 255, 255, 0.18);
    }
    .view-name {
      cursor: pointer;
      flex: 1 1 auto;
      font-weight: 600;
      font-size: 0.85rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-right: 56px;
    }
    .view-controls {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
    }
    .view-btn {
      background: #f7f7f7;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 0.75rem;
      line-height: 1;
    }
    .view-btn:hover {
      background: #ececec;
    }
    /* Tools list styling (migrated from www/css/main.css) */
    /* Plugin/tool buttons render as .chip.sidebar-chip inside #toolsList */
    #toolsList {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    #toolsList .sidebar-list-item {
      display: block;
    }
    #toolsList .sidebar-chip {
      padding: 6px 8px;
      border-radius: 8px;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: var(--color-sidebar-text);
      font-weight: 600;
      font-size: 0.85rem;
    }
    #toolsList .sidebar-chip:hover {
      background: rgba(255, 255, 255, 0.06);
      cursor: pointer;
    }
    #toolsList .sidebar-chip:focus-visible {
      outline: 2px solid #5cc8ff;
      outline-offset: 2px;
    }
    #toolsList .chip-icon {
      width: 18px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 8px;
      flex: 0 0 18px;
    }
    #toolsList .plugin-meta {
      color: rgba(255, 255, 255, 0.85);
      font-size: 0.8rem;
      margin-left: auto;
    }
    /* Match active style to scenario items for consistency */
    #toolsList .sidebar-chip.active {
      background: rgba(255, 255, 255, 0.18);
      color: var(--color-sidebar-text);
      border-color: transparent;
    }
  `;
