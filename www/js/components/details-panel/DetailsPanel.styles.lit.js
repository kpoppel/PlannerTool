import { css } from '../../vendor/lit.js';

export const DETAILS_PANEL_STYLES = css`
    :host {
      display: block;
    }
    .panel {
      position: fixed;
      right: 0;
      top: 40px;
      bottom: 0;
      width: var(--details-width, 340px);
      background: var(--color-panel-bg, #f9f9f9);
      border-left: 1px solid var(--color-border, #ccc);
      box-shadow: -2px 0 8px var(--color-shadow, rgba(0, 0, 0, 0.08));
      z-index: var(--z-details, 1000);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel.closed {
      display: none;
    }
    .details-header {
      position: relative;
      padding: 22px 18px 8px 18px;
      flex: 0 0 auto;
    }
    .details-content {
      padding: 0 18px 22px 18px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      flex: 1 1 auto;
    }
    /* match app font sizing and rhythm */
    :host {
      font-size: 14px;
    }
    .details-label {
      font-weight: bold;
      margin-top: 6px;
      font-size: 14px;
    }
    .title-icon {
      display: inline-flex;
      width: 20px;
      height: 20px;
      vertical-align: middle;
      margin-right: 8px;
    }
    .details-value {
      margin-bottom: 8px;
      font-size: 14px;
    }
    .details-changed {
      background: #fadd92ff;
    }
    .date-input {
      flex: 1 1 0;
      min-width: 0;
      padding: 4px 4px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 12px;
      font-family: Arial, sans-serif;
      background: #fff;
      box-sizing: border-box;
    }
    .date-input.details-changed {
      background: #fadd92ff;
      border-color: #e6b020;
    }
    .date-row {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 4px;
      margin-top: 2px;
    }
    .date-sep {
      flex: 0 0 auto;
      color: #888;
      font-size: 13px;
      padding: 0 2px;
    }
    .date-toolbar {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
      flex-wrap: wrap;
    }
    .date-tool-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid rgba(35,52,77,0.18);
      border-radius: 5px;
      background: rgba(35,52,77,0.06);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      color: #23344d;
      flex: 0 0 auto;
      transition: background 0.12s;
    }
    .date-tool-btn:hover {
      background: rgba(35,52,77,0.14);
    }
    .date-tool-sep {
      width: 1px;
      height: 16px;
      background: #ccc;
      flex: 0 0 auto;
      margin: 0 2px;
    }
    .clear-dates-btn {
      display: inline-flex;
      align-items: center;
      height: 24px;
      font-size: 12px;
      color: #c0392b;
      cursor: pointer;
      background: none;
      border: 1px solid rgba(192,57,43,0.25);
      border-radius: 5px;
      padding: 0 6px;
    }
    .clear-dates-btn:hover {
      background: rgba(192,57,43,0.07);
    }
    .iteration-select {
      width: 100%;
      font-size: 13px;
      padding: 4px 6px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: #fff;
      box-sizing: border-box;
    }
    .iteration-select.dates-override {
      border-style: dashed;
      border-color: #e6a817;
      outline: none;
    }
    .iteration-select.iteration-dirty {
      border-style: solid;
      border-color: #e6a817;
      outline: none;
    }
    /* Both dirty AND mismatch: keep dashed to surface the mismatch hint */
    .iteration-select.iteration-dirty.dates-override {
      border-style: dashed;
      border-color: #e6a817;
    }
    /* Status color variants (migrated from global CSS into details panel) */
    .status-new {
      color: #27ae60;
    }
    .status-inprogress {
      color: #f1c40f;
    }
    .status-done {
      color: #888;
    }
    .details-change-banner {
      background: #fff8e6;
      border: 1px solid #f0d7a6;
      padding: 8px 10px;
      border-radius: 6px;
      margin-top: 8px;
      font-size: 13px;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .details-revert {
      background: transparent;
      border: 1px solid #ccc;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .original-date {
      color: #666;
      font-size: 12px;
      margin-left: 6px;
    }
    .details-close {
      position: absolute;
      right: 18px;
      top: 18px;
      cursor: pointer;
      border: none;
      background: transparent;
      font-size: 18px;
    }
    .team-load-box {
      padding: 4px 8px;
      border-radius: 6px;
      color: white;
      font-weight: 600;
      margin-right: 6px;
      font-size: 12px;
    }
    .azure-relations-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .relations-group {
      margin-bottom: 10px;
    }
    /* Capacity Progress Bars */
    .capacity-section {
      margin-top: 12px;
    }
    .capacity-bars {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
    .capacity-bar-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      position: relative;
    }
    .capacity-bar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 16px;
    }
    .capacity-bar-name {
      font-size: 13px;
      font-weight: 600;
      color: #2c3e50;
    }
    .capacity-bar-delete {
      display: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      border: 1.5px solid #dc3545;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
      opacity: 0.7;
      transition: all 0.2s ease;
    }
    .capacity-bar-row:hover .capacity-bar-delete {
      display: flex;
    }
    .capacity-bar-delete:hover {
      background: #dc3545 !important;
      opacity: 1;
    }
    .capacity-bar-delete:hover::before {
      color: #ffffff;
    }
    .capacity-bar-container {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 18px;
    }
    .capacity-bar-bg {
      flex: 1;
      height: 18px;
      background: #e9ecef;
      border-radius: 9px;
      position: relative;
      overflow: hidden;
      cursor: pointer;
      transition: box-shadow 0.2s ease;
    }
    .capacity-bar-row:hover .capacity-bar-bg {
      box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3);
    }
    .capacity-bar-fill {
      height: 100%;
      border-radius: 9px;
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .capacity-bar-label {
      font-family: Arial, sans-serif;
      font-size: 11px;
      font-weight: bold;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    .capacity-bar-input-container {
      flex: 0 0 auto;
      position: relative;
    }
    .capacity-bar-input {
      width: 50px;
      height: 14px;
      padding: 2px 4px;
      border: 1px solid #ccc;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.9);
      font-family: monospace;
      font-size: 10px;
      text-align: center;
      outline: none;
      -moz-appearance: textfield;
      cursor: text;
      transition: border-color 0.2s ease;
    }
    .capacity-bar-input:focus {
      border-color: #3498db;
      border-width: 2px;
      background: white;
    }
    .capacity-bar-input::-webkit-outer-spin-button,
    .capacity-bar-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .add-team-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .add-team-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 18px;
      border: 1.5px dashed #3498db;
      border-radius: 9px;
      background: white;
      color: #3498db;
      font-weight: 600;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 8px;
    }
    .add-team-btn:hover {
      background: #f0f8ff;
      border-color: #2980b9;
    }
    .add-team-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      background: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 6px;
    }
    .add-team-form select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 11px;
    }
    .iteration-select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 13px;
      background: white;
      margin-top: 6px;
    }
    .details-changed {
      background: #fadd92ff;
    }
    .details-change-banner {
      background: #fff8e6;
      border: 1px solid #f0d7a6;
      padding: 8px 10px;
      border-radius: 6px;
      margin-top: 8px;
      font-size: 13px;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .details-revert {
      background: transparent;
      border: 1px solid #ccc;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .original-date {
      color: #666;
      font-size: 12px;
      margin-left: 6px;
    }
    .details-close {
      position: absolute;
      right: 18px;
      top: 18px;
      cursor: pointer;
      border: none;
      background: transparent;
      font-size: 18px;
    }
    .team-load-box {
      padding: 4px 8px;
      border-radius: 6px;
      color: white;
      font-weight: 600;
      margin-right: 6px;
      font-size: 12px;
    }
    .azure-relations-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    /* Capacity Progress Bars */
    .capacity-section {
      margin-top: 12px;
    }
    .capacity-bars {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
    .capacity-bar-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      position: relative;
    }
    .capacity-bar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 16px;
    }
    .capacity-bar-name {
      font-size: 13px;
      font-weight: 600;
      color: #2c3e50;
    }
    .capacity-bar-delete {
      display: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      border: 1.5px solid #dc3545;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
      opacity: 0.7;
      transition: all 0.2s ease;
    }
    .capacity-bar-row:hover .capacity-bar-delete {
      display: flex;
    }
    .capacity-bar-delete:hover {
      background: #dc3545 !important;
      opacity: 1;
    }
    .capacity-bar-delete:hover::before {
      color: #ffffff;
    }
    .capacity-bar-container {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 18px;
    }
    .capacity-bar-bg {
      flex: 1;
      height: 18px;
      background: #e9ecef;
      border-radius: 9px;
      position: relative;
      overflow: hidden;
      cursor: pointer;
      transition: box-shadow 0.2s ease;
    }
    .capacity-bar-row:hover .capacity-bar-bg {
      box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3);
    }
    .capacity-bar-fill {
      height: 100%;
      border-radius: 9px;
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .capacity-bar-label {
      font-family: Arial, sans-serif;
      font-size: 11px;
      font-weight: bold;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    .capacity-bar-input-container {
      flex: 0 0 auto;
      position: relative;
    }
    .capacity-bar-input {
      width: 50px;
      height: 14px;
      padding: 2px 4px;
      border: 1px solid #ccc;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.9);
      font-family: monospace;
      font-size: 10px;
      text-align: center;
      outline: none;
      -moz-appearance: textfield;
      cursor: text;
      transition: border-color 0.2s ease;
    }
    .capacity-bar-input:focus {
      border-color: #3498db;
      border-width: 2px;
      background: white;
    }
    .capacity-bar-input::-webkit-outer-spin-button,
    .capacity-bar-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .add-team-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .add-team-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 18px;
      border: 1.5px dashed #3498db;
      border-radius: 9px;
      background: white;
      color: #3498db;
      font-weight: 600;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 8px;
    }
    .add-team-btn:hover {
      background: #f0f8ff;
      border-color: #2980b9;
    }
    .add-team-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      background: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 6px;
    }
    .add-team-form select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 11px;
    }
    .add-team-form-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .add-team-form input {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 11px;
      -moz-appearance: textfield;
    }
    .add-team-form input::-webkit-outer-spin-button,
    .add-team-form input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .add-team-form-buttons {
      display: flex;
      gap: 6px;
    }
    .add-team-form button {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #3498db;
      color: white;
      font-size: 11px;
      cursor: pointer;
      font-weight: 600;
    }
    .add-team-form button:hover {
      background: #2980b9;
    }
    .add-team-form button.cancel {
      background: transparent;
      color: #666;
    }
    .add-team-form button.cancel:hover {
      background: #f5f5f5;
    }
    .total-allocation-box {
      margin-top: 16px;
      padding: 12px;
      background: #fff8e6;
      border: 1.5px solid #f39c12;
      border-radius: 6px;
    }
    .total-allocation-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: bold;
      color: #856404;
      font-size: 10px;
      margin-bottom: 8px;
    }
    .total-allocation-summary-bar {
      height: 20px;
      background: #e9ecef;
      border-radius: 10px;
      overflow: hidden;
      display: flex;
    }
    .total-allocation-segment {
      height: 100%;
      transition: width 0.3s ease;
    }
    /* align icon with text baseline for pixel-accurate centering */
    .azure-relation-item {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 0;
      background: transparent;
      border-radius: 4px;
      margin: 6px 0;
    }
    .relation-icon {
      width: 1.2em;
      height: 1.2em;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1em;
      border-radius: 0.6em;
      background: rgba(0, 0, 0, 0.06);
      flex: 0 0 1.2em;
      cursor: pointer;
    }
    .relation-content {
      display: flex;
      flex-direction: row;
      gap: 8px;
      align-items: center;
    }
    .relation-state-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex: 0 0 12px;
    }
    .relation-title,
    .relation-title a.details-link {
      line-height: 18px;
      display: inline-block;
      vertical-align: middle;
      margin: 0;
    }
    .relation-title {
      font-weight: 700;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 220px;
      line-height: 1.1;
    }
    .relation-title a.details-link {
      color: var(--color-accent, #3498db);
      text-decoration: underline;
    }
    .state-chip {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 13px;
      vertical-align: middle;
    }
    .state-select {
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid #ccc;
      font-size: 13px;
    }
    .state-choices button.state-chip {
      padding: 6px 8px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 13px;
    }
    .state-edit-row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .state-current-wrapper {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }
    .state-choices-box {
      flex: 1 1 auto;
      border: 1px solid #e0e0e0;
      background: #fff;
      padding: 8px;
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }
    .state-choices {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .state-choices button.state-chip.selected {
      box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.12);
    }
    .tags-section {
      margin-top: 12px;
    }
    .tags-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
      margin-bottom: 6px;
    }
    .tag-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid #c7d2df;
      background: #f2f7fc;
      color: #23344d;
      font-size: 12px;
      line-height: 1;
    }
    .tag-chip button {
      border: none;
      background: transparent;
      color: #8a3b2e;
      cursor: pointer;
      font-size: 12px;
      padding: 0;
      line-height: 1;
    }
    .tag-editor-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .tag-input {
      flex: 1;
      min-width: 0;
      padding: 4px 6px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 12px;
      background: #fff;
      box-sizing: border-box;
    }
    .tag-add-btn {
      height: 26px;
      padding: 0 9px;
      border: 1px solid #c4d7eb;
      border-radius: 6px;
      background: #e9f3fc;
      color: #214f78;
      font-size: 12px;
      cursor: pointer;
    }
    .tag-add-btn:hover {
      background: #deedf9;
    }
  `;
