import { LitElement, html, css } from '../vendor/lit.js';
import { state, PALETTE } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import {
  ProjectEvents,
  TeamEvents,
  ScenarioEvents,
  DataEvents,
  PluginEvents,
  ViewEvents,
  ViewManagementEvents,
  FilterEvents,
  StateFilterEvents,
  TimelineEvents,
  FeatureEvents,
} from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import { pluginManager } from '../core/PluginManager.js';
import { getIconTemplate } from '../services/IconService.js';

export class SidebarLit extends LitElement {
  static properties = {
    open: { type: Boolean },
    projects: { type: Array },
    teams: { type: Array },
    scenarios: { type: Array },
    activeScenarioId: { type: String },
    views: { type: Array },
    activeViewId: { type: String },
    activeViewData: { type: Object },
    serverStatus: { type: String },
    serverName: { type: String },
  };

  static styles = css`
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
      /* reserve space for footer using a variable so layout adapts */
      --sidebar-footer-height: 44px;
      height: calc(100vh - 40px);
      word-wrap: break-word;
      word-break: break-word;
    }

    /* Make content area scrollable and fill available space */
    .sidebar-content {
      flex: 1;
      overflow: hidden auto;
      padding-bottom: 40px;
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

    /* Expand Dataset section */
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
      height: 16px;
      border: 1px solid #5481e6;
      color: #5cc8ff;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      margin-left: 3px;
    }

    /* Sidebar footer/config */
    /* Footer stays at bottom */
    .sidebar-config {
      flex-shrink: 0;
      position: fixed;
      bottom: 0;
      left: 0;
      width: var(--sidebar-width);
      padding: 0 6px;
      background: var(--color-sidebar-bg);
      box-sizing: border-box;
      z-index: 1000;
      overflow: hidden;
    }
    .sidebar-config .sidebar-footer-box {
      background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.03) 0%,
        rgba(255, 255, 255, 0.01) 100%
      );
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      padding: 6px 8px; /* give a bit more breathing room */
      display: block;
      line-height: 1.2; /* slightly increased line spacing */
      gap: 0;
      min-height: 0;
    }
    .sidebar-config .footer-line {
      font-size: 12px;
      color: var(--color-sidebar-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
      margin: 0;
    }
    .sidebar-config .footer-line.author {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.85);
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

  constructor() {
    super();
    this.open = true;
    this.serverStatus = 'loading';
    this.serverName = null;
    // Global popover styles are provided by TopMenu; no sidebar-specific injection needed
    this._didRestoreSidebarState = false;

    // Reactive properties
    this.projects = [];
    this.teams = [];
    this.scenarios = [];
    this.activeScenarioId = null;
    this.views = [];
    this.activeViewId = null;
    this.activeViewData = null;
    // Data funnel metrics
    this.selectedTasksCount = 0;
    this.expandedTasksCount = 0; // placeholder until expansion features implemented
    this.displayedTasksCount = 0;
    // Expansion filter state
    this.expandParentChild = false;
    this.expandRelations = false;
    this.expandTeamAllocated = false;
    // Expansion counts for display
    this.expandParentChildCount = 0;
    this.expandRelationsCount = 0;
    this.expandTeamAllocatedCount = 0;
    // Task filter state (from TaskFilterService)
    this.taskFilters = {
      schedule: { planned: true, unplanned: true },
      allocation: { allocated: true, unallocated: true },
      hierarchy: { hasParent: true, noParent: true },
      relations: { hasLinks: true, noLinks: true },
    };
    // Dynamic state & type filters (populated from baseline/features)
    this.availableFeatureStates = state.availableFeatureStates || [];
    this.availableTaskTypes = [];
    this.selectedTaskTypes = new Set();
    this._taskTypesInitialized = false;
    // Controls disabled by external components (plugins)
    this._disabledSidebar = {};
  }

  connectedCallback() {
    super.connectedCallback();
    // Using shadow DOM; `static styles` will apply automatically.
    // Wire event handlers to update reactive properties
    this._onProjectsChanged = (projects) => {
      this.projects = projects ? [...projects] : [];
      this._recomputeDataFunnel && this._recomputeDataFunnel();
    };
    this._onTeamsChanged = (teams) => {
      this.teams = teams ? [...teams] : [];
      this._recomputeDataFunnel && this._recomputeDataFunnel();
    };
    this._onScenariosList = (payload) => {
      // Use the authoritative scenario objects from `state.scenarios` so
      // the UI has access to `overrides` and `isChanged` flags. The
      // ScenarioEvents.LIST payload contains reduced metadata for lists,
      // which would strip overrides and unsaved markers.
      try {
        const full = state.scenarios || [];
        this.scenarios = Array.isArray(full) ? [...full] : [];
      } catch (e) {
        // Fallback to payload if state is not ready
        const list = payload && payload.scenarios ? payload.scenarios : [];
        this.scenarios = Array.isArray(list) ? [...list] : [];
      }
      // Prefer explicit activeScenarioId from payload if present, otherwise use state
      if (payload && payload.activeScenarioId)
        this.activeScenarioId = payload.activeScenarioId;
      else this.activeScenarioId = state.activeScenarioId;
    };
    this._onScenarioActivated = (payload) => {
      this.activeScenarioId =
        payload && payload.scenarioId ? payload.scenarioId : state.activeScenarioId;
    };
    this._onScenariosUpdated = () => {
      const sc = state.scenarios || [];
      this.scenarios = [...sc];
      this.activeScenarioId = state.activeScenarioId;
    };
    this._onViewsList = (payload) => {
      console.log('[Sidebar] Received views list event:', payload);
      this.views = payload && payload.views ? [...payload.views] : [];
      this.activeViewId = payload && payload.activeViewId ? payload.activeViewId : null;
      this.activeViewData =
        payload && payload.activeViewData ? payload.activeViewData : null;
      this.requestUpdate();
    };
    this._onViewActivated = (payload) => {
      console.log('[Sidebar] Received view activated event:', payload);
      this.activeViewId = payload && payload.viewId ? payload.viewId : null;
      this.activeViewData =
        payload && payload.activeViewData ? payload.activeViewData : null;
      this.requestUpdate();
    };

    bus.on(ProjectEvents.CHANGED, this._onProjectsChanged);
    bus.on(TeamEvents.CHANGED, this._onTeamsChanged);
    bus.on(ScenarioEvents.LIST, this._onScenariosList);
    bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    bus.on(ScenarioEvents.UPDATED, this._onScenariosUpdated);
    bus.on(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    bus.on(ViewManagementEvents.LIST, this._onViewsList);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);
    // Recompute data funnel when features or filters change
    this._recomputeDataFunnel = () => {
      try {
        const feats =
          (state.featureService &&
            state.featureService.getEffectiveFeatures &&
            state.featureService.getEffectiveFeatures()) ||
          [];
        const selectedProjectIds = (this.projects || [])
          .filter((p) => p && p.selected)
          .map((p) => p.id);

        // Selected tasks: features whose project is selected
        const selectedFeatureIds = new Set(
          feats.filter((f) => selectedProjectIds.includes(f.project)).map((f) => f.id)
        );
        this.selectedTasksCount = selectedFeatureIds.size;

        // Expanded tasks: apply expansion filters
        const selectedTeamIds = (this.teams || [])
          .filter((t) => t && t.selected)
          .map((t) => t.id);
        const expansionResult =
          state.featureService && state.featureService.computeExpandedFeatureSet ?
            state.featureService.computeExpandedFeatureSet(selectedFeatureIds, {
              expandParentChild: this.expandParentChild,
              expandRelations: this.expandRelations,
              expandTeamAllocated: this.expandTeamAllocated,
              selectedTeamIds: selectedTeamIds,
            })
          : {
              expandedIds: selectedFeatureIds,
              counts: { parentChild: 0, relations: 0, teamAllocated: 0 },
            };

        const expandedFeatureIds = expansionResult.expandedIds;
        this.expandedTasksCount = expandedFeatureIds.size - this.selectedTasksCount;
        this.expandParentChildCount = expansionResult.counts.parentChild;
        this.expandRelationsCount = expansionResult.counts.relations;
        this.expandTeamAllocatedCount = expansionResult.counts.teamAllocated;

        // Displayed tasks: apply state filter and view filters to expanded set
        const stateFilter = state.selectedFeatureStateFilter || new Set();
        // Build a lowercase version of the selected state set for case-insensitive checks
        const stateFilterLower =
          stateFilter && typeof stateFilter.size !== 'undefined' ?
            new Set(Array.from(stateFilter).map((s) => String(s).toLowerCase()))
          : new Set();

        let displayedFeatures = feats.filter((f) => expandedFeatureIds.has(f.id));

        // Apply state filter (case-insensitive using original configured state casing)
        if (stateFilterLower && stateFilterLower.size > 0) {
          displayedFeatures = displayedFeatures.filter((f) =>
            stateFilterLower.has((f.state || '').toLowerCase())
          );
        }

        // Apply task filters
        if (state.taskFilterService) {
          displayedFeatures = displayedFeatures.filter((f) =>
            state.taskFilterService.featurePassesFilters(f)
          );
        }

        this.displayedTasksCount = displayedFeatures.length;
      } catch (e) {
        console.warn('[Sidebar] _recomputeDataFunnel error:', e);
        this.selectedTasksCount = 0;
        this.expandedTasksCount = 0;
        this.displayedTasksCount = 0;
        this.expandParentChildCount = 0;
        this.expandRelationsCount = 0;
        this.expandTeamAllocatedCount = 0;
      }
      this.requestUpdate();
    };
    bus.on(FeatureEvents.UPDATED, this._recomputeDataFunnel);
    bus.on(FilterEvents.CHANGED, this._recomputeDataFunnel);
    bus.on(StateFilterEvents.CHANGED, this._recomputeDataFunnel);
    // Keep local copies of dynamic state/type lists in sync
    this._onAvailableStatesChanged = (states) => {
      this.availableFeatureStates =
        Array.isArray(states) ? [...states] : state.availableFeatureStates || [];
      this.requestUpdate();
    };
    bus.on(StateFilterEvents.CHANGED, this._onAvailableStatesChanged);

    // Listen for task filter updates from TaskFilterService
    this._onTaskFiltersChanged = (payload) => {
      if (payload && payload.taskFilters) {
        this.taskFilters = payload.taskFilters;
        this.requestUpdate();
      }
    };
    bus.on(FilterEvents.CHANGED, this._onTaskFiltersChanged);

    // Listen for sidebar disabled maps emitted via state
    this._onSidebarFilterChanged = (payload) => {
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'disabledSidebar')) {
        this._disabledSidebar = payload.disabledSidebar || {};
        this.requestUpdate();
      }
      // Allow external callers (plugins) to programmatically set which
      // task types are selected in the sidebar via FilterEvents.CHANGED
      // with `selectedTaskTypes: [ ... ]`.
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'selectedTaskTypes')) {
        const arr =
          Array.isArray(payload.selectedTaskTypes) ? payload.selectedTaskTypes : [];
        this.selectedTaskTypes = new Set(arr);
        // Sync to ViewService so the board filter matches (external callers or
        // plugin-driven selectedTaskTypes must also be reflected in _hiddenTypes).
        if (state && state._viewService) {
          for (const t of (this.availableTaskTypes || [])) {
            state._viewService.setTypeVisibility(t, this.selectedTaskTypes.has(t), /* suppressEmit= */true);
          }
        }
        // Mark types initialized so default-selection logic does not override
        this._taskTypesInitialized = true;
        this.requestUpdate();
      }
    };
    bus.on(FilterEvents.CHANGED, this._onSidebarFilterChanged);

    this._onFeaturesForTypes = () => {
      this._computeAvailableTaskTypes();
    };
    bus.on(FeatureEvents.UPDATED, this._onFeaturesForTypes);
    // Listen for view option changes to trigger sidebar state save
    const onViewOptionChange = () => {
      /* auto-save removed - use View feature instead */
    };
    bus.on(ViewEvents.CONDENSED, onViewOptionChange);
    bus.on(ViewEvents.DEPENDENCIES, onViewOptionChange);
    bus.on(ViewEvents.CAPACITY_MODE, (mode) => {
      // Sync local _graphType when capacity mode changes
      this._graphType = mode || 'team';
      this.requestUpdate();
      onViewOptionChange();
    });
    bus.on(ViewEvents.SORT_MODE, onViewOptionChange);
    bus.on(FilterEvents.CHANGED, onViewOptionChange);
    bus.on(StateFilterEvents.CHANGED, onViewOptionChange);
    bus.on(TimelineEvents.SCALE_CHANGED, onViewOptionChange); // Save when timeline zoom changes
    this._viewOptionChangeHandler = onViewOptionChange;
    // Initialize reactive properties from current state in case events were
    // emitted before this element was connected. This ensures the component
    // renders current projects/teams immediately instead of waiting for
    // subsequent change events.
    try {
      this._onProjectsChanged(state.projects);
      this._onTeamsChanged(state.teams);
      this._onScenariosList({
        scenarios: state.scenarios,
        activeScenarioId: state.activeScenarioId,
      });
      console.log('[Sidebar] Initializing views from state:', state.savedViews);
      this._onViewsList({
        views: state.savedViews,
        activeViewId: state.activeViewId,
      });
      // Initialize task filters from service
      if (state.taskFilterService) {
        this.taskFilters = state.taskFilterService.getFilters();
      }
      // Initialize state & task type filters
      this.availableFeatureStates = state.availableFeatureStates || [];
      this._computeAvailableTaskTypes();
      // Initialize graph type from current capacityViewMode
      this._graphType = state.capacityViewMode || 'team';
    } catch (e) {
      // Defensive: ignore if state is not yet ready
      console.warn('[Sidebar] Error initializing from state:', e);
    }
    this.refreshServerStatus();
    this.requestUpdate();

    // Keyboard shortcut handlers were removed; shortcuts now limited to global search (Ctrl+Shift+F).
  }

  firstUpdated() {
    const headers = this.shadowRoot.querySelectorAll(
      '.sidebar-section-header-collapsible'
    );
    this._collapsibleHandlers = Array.from(headers).flatMap((header) => {
      const section = header.parentElement;
      const contentWrapper = section.children[1];
      const chevron = header.querySelector('.sidebar-chevron');

      const toggleSection = () => {
        const isCollapsed = contentWrapper.classList.toggle('sidebar-section-collapsed');
        if (chevron) chevron.textContent = isCollapsed ? '▲' : '▼';
        // Save sidebar state when section is toggled
        // Auto-save removed - use View feature instead
      };

      const onHeaderClick = () => toggleSection();
      header.addEventListener('click', onHeaderClick);

      const handlers = [{ el: header, fn: onHeaderClick }];
      if (chevron) {
        const onChevronClick = (e) => {
          e.stopPropagation();
          toggleSection();
        };
        chevron.addEventListener('click', onChevronClick);
        handlers.push({ el: chevron, fn: onChevronClick });
      }
      return handlers;
    });

    const onPluginsChanged = () => this.requestUpdate();
    this._onPluginsChanged = onPluginsChanged;
    [
      PluginEvents.REGISTERED,
      PluginEvents.UNREGISTERED,
      PluginEvents.ACTIVATED,
      PluginEvents.DEACTIVATED,
    ].forEach((evt) => bus.on(evt, onPluginsChanged));

    // Sidebar state restore removed - views are now the primary persistence mechanism
    // Last active view will be restored via ViewManagementService on app init
  }

  disconnectedCallback() {
    // Remove reactive property handlers
    if (this._onProjectsChanged) bus.off(ProjectEvents.CHANGED, this._onProjectsChanged);
    if (this._onTeamsChanged) bus.off(TeamEvents.CHANGED, this._onTeamsChanged);
    if (this._onScenariosList) bus.off(ScenarioEvents.LIST, this._onScenariosList);
    if (this._onScenarioActivated)
      bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    if (this._onScenariosUpdated) {
      bus.off(ScenarioEvents.UPDATED, this._onScenariosUpdated);
      bus.off(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    }

    // Clean up view option change listeners
    const viewHandler = this._viewOptionChangeHandler;
    if (viewHandler) {
      bus.off(ViewEvents.CONDENSED, viewHandler);
      bus.off(ViewEvents.DEPENDENCIES, viewHandler);
      bus.off(ViewEvents.CAPACITY_MODE, viewHandler);
      bus.off(ViewEvents.SORT_MODE, viewHandler);
      bus.off(FilterEvents.CHANGED, viewHandler);
      bus.off(StateFilterEvents.CHANGED, viewHandler);
      bus.off(TimelineEvents.SCALE_CHANGED, viewHandler);
    }
    if (this._recomputeDataFunnel) {
      bus.off(FeatureEvents.UPDATED, this._recomputeDataFunnel);
      bus.off(FilterEvents.CHANGED, this._recomputeDataFunnel);
      bus.off(StateFilterEvents.CHANGED, this._recomputeDataFunnel);
      this._recomputeDataFunnel = null;
    }
    if (this._onAvailableStatesChanged)
      bus.off(StateFilterEvents.CHANGED, this._onAvailableStatesChanged);
    if (this._onTaskFiltersChanged)
      bus.off(FilterEvents.CHANGED, this._onTaskFiltersChanged);
    if (this._onSidebarFilterChanged)
      bus.off(FilterEvents.CHANGED, this._onSidebarFilterChanged);
    if (this._onFeaturesForTypes)
      bus.off(FeatureEvents.UPDATED, this._onFeaturesForTypes);

    this._collapsibleHandlers?.forEach((h) => h.el.removeEventListener('click', h.fn));
    this._collapsibleHandlers = null;

    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }

    if (this._onPluginsChanged) {
      [
        PluginEvents.REGISTERED,
        PluginEvents.UNREGISTERED,
        PluginEvents.ACTIVATED,
        PluginEvents.DEACTIVATED,
      ].forEach((evt) => bus.off(evt, this._onPluginsChanged));
    }
  }

  _toggleExpansion(type) {
    if (type === 'parentChild') {
      this.expandParentChild = !this.expandParentChild;
    } else if (type === 'relations') {
      this.expandRelations = !this.expandRelations;
    } else if (type === 'teamAllocated') {
      this.expandTeamAllocated = !this.expandTeamAllocated;
    }
    // Sync expansion state to State service
    state.setExpansionState({
      expandParentChild: this.expandParentChild,
      expandRelations: this.expandRelations,
      expandTeamAllocated: this.expandTeamAllocated,
    });
    // Trigger data funnel recomputation
    this._recomputeDataFunnel && this._recomputeDataFunnel();
    // Emit filter change event so the board updates
    bus.emit(FilterEvents.CHANGED, {
      expansion: {
        parentChild: this.expandParentChild,
        relations: this.expandRelations,
        teamAllocated: this.expandTeamAllocated,
      },
    });
  }

  _toggleTaskFilter(dimension, option) {
    state.taskFilterService.toggleFilter(dimension, option);
    this.taskFilters = state.taskFilterService.getFilters();
    this._recomputeDataFunnel && this._recomputeDataFunnel();
    // Auto-save removed - use View feature instead
    this.requestUpdate();
  }

  // Compute available task types from baseline/features (no hardcoded fallback)
  _computeAvailableTaskTypes() {
    try {
      const baseline = state.baselineFeatures || [];
      const types = new Set();
      baseline.forEach((f) => {
        const t = f.type || f.workItemType || f.work_item_type || null;
        if (t) types.add(String(t));
      });
      // Order by hierarchy level when a hierarchy is configured; fall back to sort.
      const unordered = Array.from(types);
      this.availableTaskTypes = state.taskTypeHierarchy && state.taskTypeHierarchy.length
        ? [...unordered].sort((a, b) => {
            const la = state.getTypeLevel(a);
            const lb = state.getTypeLevel(b);
            if (la !== lb) return la - lb;
            return a.localeCompare(b);
          })
        : unordered.sort();
      // Default selection only on first initialization AND only when types are available.
      // Guard: if connectedCallback fires before data loads (availableTaskTypes=[]), do NOT
      // set _taskTypesInitialized=true yet — allow the next call (after data loads) to init.
      if (!this._taskTypesInitialized && this.availableTaskTypes.length > 0) {
        if (!this.selectedTaskTypes || this.selectedTaskTypes.size === 0) {
          this.selectedTaskTypes = new Set(this.availableTaskTypes);
          // emit initial filter so other parts can respond
          bus.emit(FilterEvents.CHANGED, {
            selectedTaskTypes: Array.from(this.selectedTaskTypes),
          });
        }
        this._taskTypesInitialized = true;
      }
      this.requestUpdate();
    } catch (e) {
      console.warn('[Sidebar] _computeAvailableTaskTypes error', e);
    }
  }

  _applySavedTaskTypes(arr) {
    if (!Array.isArray(arr)) return;
    const valid = (this.availableTaskTypes || []).filter((t) => arr.includes(t));
    this.selectedTaskTypes = new Set(valid);
    bus.emit(FilterEvents.CHANGED, {
      selectedTaskTypes: Array.from(this.selectedTaskTypes),
    });
    this.requestUpdate();
    this._taskTypesInitialized = true;
  }

  // Returns true if a control has been disabled via state.setSidebarDisabledElements
  _isControlDisabled(kind, key, opt) {
    if (!this._disabledSidebar) return false;
    if (kind === 'taskFilter') {
      const tf = this._disabledSidebar.taskFilters || {};
      if (tf && Array.isArray(tf[key]) && opt) return tf[key].includes(opt);
    }
    if (kind === 'taskType') {
      const t = this._disabledSidebar.taskTypes || [];
      return Array.isArray(t) && t.includes(key);
    }
    if (kind === 'expansion') {
      const e = this._disabledSidebar.expansion || [];
      return Array.isArray(e) && e.includes(key);
    }
    if (kind === 'state') {
      const s = this._disabledSidebar.states || [];
      return Array.isArray(s) && s.includes(key);
    }
    return false;
  }

  // Programmatic API: set a task filter option checked/unchecked
  setTaskFilterChecked(dimension, option, checked) {
    if (
      state &&
      state.taskFilterService &&
      typeof state.taskFilterService.setFilter === 'function'
    ) {
      state.taskFilterService.setFilter(dimension, option, !!checked);
      this.taskFilters = state.taskFilterService.getFilters();
      this._recomputeDataFunnel && this._recomputeDataFunnel();
      this.requestUpdate();
    }
  }

  // Programmatic API: set a task type checked/unchecked
  setTaskTypeChecked(type, checked) {
    if (!this.selectedTaskTypes) this.selectedTaskTypes = new Set();
    if (checked) this.selectedTaskTypes.add(type);
    else this.selectedTaskTypes.delete(type);
    // Sync to ViewService (authoritative source for board filter)
    if (state && state._viewService) {
      state._viewService.setTypeVisibility(type, !!checked);
    }
    bus.emit(FilterEvents.CHANGED, {
      selectedTaskTypes: Array.from(this.selectedTaskTypes),
    });
    this.requestUpdate();
  }

  // Programmatic API: disable/enable sidebar controls via State service
  disableSidebarElements(map) {
    state.setSidebarDisabledElements(map || {});
  }
  clearSidebarDisabledElements() {
    state.clearSidebarDisabledElements();
  }

  _toggleTaskType(type) {
    if (!type) return;
    // Use ViewService as the authoritative source for current visibility —
    // avoids stale-selectedTaskTypes bugs when selectedTaskTypes was never
    // initialised (e.g. data loaded after connectedCallback ran with no features).
    const isCurrentlyVisible =
      state && state._viewService ? state._viewService.isTypeVisible(type) : true;
    const nowVisible = !isCurrentlyVisible;

    // Keep selectedTaskTypes in sync for persistence (view save/restore)
    if (!this.selectedTaskTypes) this.selectedTaskTypes = new Set();
    if (nowVisible) this.selectedTaskTypes.add(type);
    else this.selectedTaskTypes.delete(type);

    // Generically update type visibility via ViewService — no hardcoded type strings
    if (state && state._viewService) {
      state._viewService.setTypeVisibility(type, nowVisible);
    }
    bus.emit(FilterEvents.CHANGED, {
      selectedTaskTypes: Array.from(this.selectedTaskTypes),
    });
    this.requestUpdate();
  }

  _renderTaskFilterDimensions() {
    const filterDimensions = [
      {
        key: 'schedule',
        title: 'Schedule',
        options: [
          { key: 'planned', label: 'Planned' },
          { key: 'unplanned', label: 'Unplanned' },
        ],
      },
      {
        key: 'allocation',
        title: 'Allocation',
        options: [
          { key: 'allocated', label: 'Allocated' },
          { key: 'unallocated', label: 'Unallocated' },
        ],
      },
      {
        key: 'hierarchy',
        title: 'Hierarchy',
        options: [
          { key: 'hasParent', label: 'Has Parent' },
          { key: 'noParent', label: 'No Parent' },
        ],
      },
      {
        key: 'relations',
        title: 'Relations',
        options: [
          { key: 'hasLinks', label: 'Has Links' },
          { key: 'noLinks', label: 'No Links' },
        ],
      },
    ];

    return html`
      <div
        class="filter-dimensions"
        style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"
      >
        ${filterDimensions.map(
          (dim) => html`
            <div class="filter-dimension">
              <div class="filter-dimension-title">${dim.title}</div>
              <div
                class="filter-options"
                style="display:flex;flex-direction:column;gap:6px;"
              >
                ${dim.options.map((opt) => {
                  const isActive = this.taskFilters[dim.key][opt.key];
                  const isDisabled = this._isControlDisabled(
                    'taskFilter',
                    dim.key,
                    opt.key
                  );
                  return html`
                    <div
                      class="filter-option ${isActive ? 'active' : ''} ${isDisabled ?
                        'disabled'
                      : ''}"
                      aria-disabled="${isDisabled ? 'true' : 'false'}"
                      @click=${() => {
                        if (!isDisabled) this._toggleTaskFilter(dim.key, opt.key);
                      }}
                      title=${isDisabled ? 'Not relevant in current tool context' : ''}
                    >
                      <div class="filter-checkbox"></div>
                      <span>${opt.label}</span>
                    </div>
                  `;
                })}
              </div>
            </div>
          `
        )}
      </div>
    `;
  }

  _renderTaskFilters() {
    // Render dynamic 'Task Filters' box with States and Types
    const states = this.availableFeatureStates || [];
    const ordered = state.availableTaskTypesOrdered;
    const types = (ordered && ordered.length > 0) ? ordered : (this.availableTaskTypes || []);
    return html`${states.length === 0 && types.length === 0 ?
      html`<div class="section-description">
        <span class="small">No filters available</span>
      </div>`
    : html``}
    ${states.length > 0 ?
      html` <div class="filter-dimension">
        <div class="filter-dimension-title">State</div>
        <div class="filter-options">
          ${(() => {
            const colors =
              state.getFeatureStateColors ? state.getFeatureStateColors() : {};
            return states.map((s) => {
              const meta = colors && colors[s] ? colors[s] : null;
              const bg =
                meta ? meta.background
                : state.getFeatureStateColor ? state.getFeatureStateColor(s)
                : '#999';
              const text = meta ? meta.text : '#fff';
              const isActive =
                state.selectedFeatureStateFilter &&
                state.selectedFeatureStateFilter.has(s);
              const isDisabled = this._isControlDisabled('state', s);
              return html` <div
                class="filter-option ${isActive ? 'active' : ''} ${isDisabled ? 'disabled'
                : ''}"
                aria-disabled="${isDisabled ? 'true' : 'false'}"
                @click=${() => {
                  if (!isDisabled) {
                    state.toggleStateSelected(s);
                    this._recomputeDataFunnel && this._recomputeDataFunnel();
                  }
                }}
                title=${isDisabled ? 'Not relevant in current tool context' : ''}
              >
                <div style="display:inline-flex;align-items:center;gap:8px;flex:1;">
                  <span
                    class="filter-state-dot"
                    style="width:14px;height:14px;border-radius:3px;display:inline-block;background:${bg};border:1px solid rgba(0,0,0,0.06);box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);"
                  ></span>
                  <div style="flex:1;color:#fff;">${s}</div>
                </div>
                <div
                  class="filter-checkbox"
                  style="margin-left:8px;${isActive ?
                    'background: rgba(102, 126, 234, 0.8); border-color: rgba(102, 126, 234, 1);'
                  : ''}"
                ></div>
              </div>`;
            });
          })()}
        </div>
      </div>`
    : html``}
    ${types.length > 0 ?
      html` <div class="filter-dimension">
        <div class="filter-dimension-title">Task Types</div>
        <div class="filter-options">
          ${types.map(
            (t) => {
              const isActive = state._viewService ? state._viewService.isTypeVisible(t)
                : (this.selectedTaskTypes && this.selectedTaskTypes.has(t));
              return html`
                <div
                  class="filter-option ${isActive ? 'active' : ''}"
                  @click=${() => this._toggleTaskType(t)}
                >
                  <div class="filter-checkbox"></div>
                  <div style="flex:1;display:flex;align-items:center;gap:4px;"><span style="width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;">${getIconTemplate(t)}</span>${t}</div>
                </div>
              `;
            }
          )}
        </div>
      </div>`
    : html``} `;
  }

  // Project/team/view rendering and menu actions moved to TopMenu and small menu components;
  // keep sidebar focused on dataset, expansions, filters and view options container.

  /**
   * Save current sidebar state to localStorage (debounced)
   * DEPRECATED: Views are now the only persistence mechanism.
   */
  _saveSidebarState() {
    // No-op: This method is deprecated - use View feature to save settings
  }

  // Handlers for Taskboard Options
  _setTimelineScale(scale) {
    try {
      state._viewService.setTimelineScale(scale);
    } catch (e) {
      console.warn('[Sidebar] setTimelineScale failed', e);
    }
    // Auto-save removed - use View feature instead
    this.requestUpdate();
  }

  _toggleCondensed() {
    try {
      state._viewService.setCondensedCards(!state._viewService.condensedCards);
    } catch (e) {
      console.warn('[Sidebar] toggleCondensed failed', e);
    }
    // Auto-save removed - use View feature instead
    this.requestUpdate();
  }

  _setFeatureSortMode(mode) {
    try {
      state._viewService.setFeatureSortMode(mode);
    } catch (e) {
      console.warn('[Sidebar] setFeatureSortMode failed', e);
    }
    // Auto-save removed - use View feature instead
    this.requestUpdate();
  }

  _setGraphType(type) {
    this._graphType = type;
    try {
      state._viewService.setCapacityViewMode(type);
    } catch (e) {
      console.warn('[Sidebar] setCapacityViewMode failed', e);
    }
    // Auto-save removed - use View feature instead
    this.requestUpdate();
  }

  /**
   * Restore sidebar state from localStorage
   * DEPRECATED: Views are restored via ViewManagementService.
   */
  async _restoreSidebarState() {
    // No-op: This method is deprecated - views restored automatically
  }

  async refreshServerStatus() {
    try {
      if (!dataService || typeof dataService.checkHealth !== 'function') {
        this.serverStatus = 'unknown';
        this.requestUpdate();
        return;
      }
      const h = await dataService.checkHealth();
      const status = (h && (h.status || (h.ok ? 'ok' : null))) || 'error';
      this.serverName = (h && (h.server_name || h.server)) || this.serverName;
      const ups = Number(h && h.uptime_seconds);
      const uptimeStr =
        Number.isNaN(ups) ? '' : (
          (() => {
            const totalMinutes = Math.floor(ups / 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return ` - Uptime: ${hours}h ${minutes}m`;
          })()
        );
      this.serverStatus = `${h.version} | Server: ${status}${uptimeStr}`;
    } catch (e) {
      this.serverStatus = 'Server: error';
    }
    this.requestUpdate();
  }

  // Scenario activation handled by TopMenu / Scenario components.

  render() {
    return html`
      <aside class="sidebar ${this.open ? '' : 'closed'}">
        <div class="sidebar-content">
          <!-- Taskboard Options (new) -->
          <section class="sidebar-section">
            <div class="expansion-section">
              <div class="section-title">🧭 Taskboard Options</div>
              <div class="section-description">
                Timeline and taskboard display settings
              </div>

              <div class="filter-dimension">
                <div class="filter-dimension-title">Timeline Scale</div>
                <div class="segmented-group">
                  <button
                    type="button"
                    class="segment-btn ${state.timelineScale === 'threeMonths' ?
                      'active'
                    : ''}"
                    @click=${() => this._setTimelineScale('threeMonths')}
                  >
                    3mo
                  </button>
                  <button
                    type="button"
                    class="segment-btn ${state.timelineScale === 'weeks' ? 'active' : ''}"
                    @click=${() => this._setTimelineScale('weeks')}
                  >
                    Weeks
                  </button>
                  <button
                    type="button"
                    class="segment-btn ${state.timelineScale === 'months' ?
                      'active'
                    : ''}"
                    @click=${() => this._setTimelineScale('months')}
                  >
                    Months
                  </button>
                  <button
                    type="button"
                    class="segment-btn ${state.timelineScale === 'quarters' ?
                      'active'
                    : ''}"
                    @click=${() => this._setTimelineScale('quarters')}
                  >
                    Quarters
                  </button>
                  <button
                    type="button"
                    class="segment-btn ${state.timelineScale === 'years' ? 'active' : ''}"
                    @click=${() => this._setTimelineScale('years')}
                  >
                    Years
                  </button>
                </div>
              </div>

              <div class="filter-dimension">
                <div class="filter-dimension-title">Display</div>
                <div class="segmented-group">
                  <button
                    type="button"
                    class="segment-btn ${!state.condensedCards ? 'active' : ''}"
                    @click=${() => state._viewService.setCondensedCards(false)}
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    class="segment-btn ${state.condensedCards ? 'active' : ''}"
                    @click=${() => state._viewService.setCondensedCards(true)}
                  >
                    Compact
                  </button>
                </div>
              </div>

              <div class="filter-dimension">
                <div class="filter-dimension-title">Task Sort</div>
                <div class="segmented-group">
                  <button
                    type="button"
                    class="segment-btn ${state.featureSortMode === 'rank' ?
                      'active'
                    : ''}"
                    @click=${() => this._setFeatureSortMode('rank')}
                  >
                    Rank
                  </button>
                  <button
                    type="button"
                    class="segment-btn ${state.featureSortMode === 'date' ?
                      'active'
                    : ''}"
                    @click=${() => this._setFeatureSortMode('date')}
                  >
                    Date
                  </button>
                </div>
              </div>

              <div class="filter-dimension">
                <div class="filter-dimension-title">Graph Type</div>
                <div class="segmented-group">
                  <button
                    type="button"
                    class="segment-btn ${this._graphType === 'team' ? 'active' : ''}"
                    @click=${() => this._setGraphType('team')}
                  >
                    Team
                  </button>
                  <button
                    type="button"
                    class="segment-btn ${this._graphType === 'project' ? 'active' : ''}"
                    @click=${() => this._setGraphType('project')}
                  >
                    Project
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section class="sidebar-section">
            <div class="dataset-status">
              <div class="status-title">Data Funnel</div>
              <div class="status-flow">
                <div class="status-item">
                  <div class="status-number">${this.selectedTasksCount}</div>
                  <div class="status-label">Selected</div>
                </div>
                <div class="status-arrow">→</div>
                <div class="status-item">
                  <div class="status-number">
                    ${this.expandedTasksCount > 0 ?
                      '+' + this.expandedTasksCount
                    : this.expandedTasksCount}
                  </div>
                  <div class="status-label">Expanded</div>
                </div>
                <div class="status-arrow">→</div>
                <div class="status-item">
                  <div class="status-number">${this.displayedTasksCount}</div>
                  <div class="status-label">Displayed</div>
                </div>
              </div>
            </div>
          </section>

          <!-- Expand Dataset Section -->
          <section class="sidebar-section">
            <div class="expansion-section">
              <div class="section-title">🔗 Expand Dataset</div>
              <div class="section-description">
                Add related tasks to your working dataset
              </div>

              <div class="option-group">
                ${(() => {
                  const disabledParentChild = this._isControlDisabled(
                    'expansion',
                    'parentChild'
                  );
                  return html` <div
                    class="option-row ${this.expandParentChild ? 'active' : ''} ${(
                      disabledParentChild
                    ) ?
                      'disabled'
                    : ''}"
                    aria-disabled="${disabledParentChild ? 'true' : 'false'}"
                    @click=${() => {
                      if (!disabledParentChild) this._toggleExpansion('parentChild');
                    }}
                    title=${disabledParentChild ?
                      'Not relevant in current tool context'
                    : ''}
                  >
                    <div class="option-label">
                      <div class="option-checkbox"></div>
                      <span>Parent/Child Links</span>
                    </div>
                    <span class="option-count"
                      >${this.expandParentChildCount > 0 ?
                        '+' + this.expandParentChildCount
                      : this.expandParentChildCount}</span
                    >
                  </div>`;
                })()}
                ${(() => {
                  const disabledRelations = this._isControlDisabled(
                    'expansion',
                    'relations'
                  );
                  return html` <div
                    class="option-row ${this.expandRelations ? 'active' : ''} ${(
                      disabledRelations
                    ) ?
                      'disabled'
                    : ''}"
                    aria-disabled="${disabledRelations ? 'true' : 'false'}"
                    @click=${() => {
                      if (!disabledRelations) this._toggleExpansion('relations');
                    }}
                    title=${disabledRelations ?
                      'Not relevant in current tool context'
                    : ''}
                  >
                    <div class="option-label">
                      <div class="option-checkbox"></div>
                      <span>Dependencies</span>
                    </div>
                    <span class="option-count"
                      >${this.expandRelationsCount > 0 ?
                        '+' + this.expandRelationsCount
                      : this.expandRelationsCount}</span
                    >
                  </div>`;
                })()}
                ${(() => {
                  const disabledTeamAllocated = this._isControlDisabled(
                    'expansion',
                    'teamAllocated'
                  );
                  return html` <div
                    class="option-row ${this.expandTeamAllocated ? 'active' : ''} ${(
                      disabledTeamAllocated
                    ) ?
                      'disabled'
                    : ''}"
                    aria-disabled="${disabledTeamAllocated ? 'true' : 'false'}"
                    @click=${() => {
                      if (!disabledTeamAllocated) this._toggleExpansion('teamAllocated');
                    }}
                    title=${disabledTeamAllocated ?
                      'Not relevant in current tool context'
                    : ''}
                  >
                    <div class="option-label">
                      <div class="option-checkbox"></div>
                      <span>Team Allocated</span>
                    </div>
                    <span class="option-count"
                      >${this.expandTeamAllocatedCount > 0 ?
                        '+' + this.expandTeamAllocatedCount
                      : this.expandTeamAllocatedCount}</span
                    >
                  </div>`;
                })()}
              </div>
            </div>
          </section>

          <!-- Task Filters Section -->
          <section class="sidebar-section">
            <div class="expansion-section">
              <div class="section-title">👁️ Task Filters</div>
              <div class="section-description">Filter displayed tasks by attributes</div>

              ${this._renderTaskFilterDimensions()}
              ${this._renderTaskFilters ? this._renderTaskFilters() : ''}
            </div>
          </section>
        </div>
        <div class="sidebar-config">
          <div class="sidebar-footer-box">
            <div class="footer-line status">
              ${this.serverName ? this.serverName + ' | ' : ''}${this.serverStatus}
            </div>
            <div class="footer-line author">PlannerTool (C) 2025-2026 Kim Poulsen</div>
          </div>
        </div>
      </aside>
    `;
  }
}

customElements.define('app-sidebar', SidebarLit);

export async function initSidebar() {
  if (!document.querySelector('app-sidebar')) {
    const el = document.createElement('app-sidebar');
    document.body.appendChild(el);
  }
}
