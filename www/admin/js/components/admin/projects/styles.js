import { css } from '/static/js/vendor/lit.js';

export const adminProjectsStyles = css`
      .compact-table-view {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
        align-items: center;
      }

      .btn {
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid #e6e6e6;
        background: #fff;
        cursor: pointer;
        font-size: 0.9rem;
      }

      .btn.primary {
        background: #3b82f6;
        color: #fff;
        border: none;
      }

      .search-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .search-input {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        max-width: 400px;
      }

      .table-container {
        overflow-x: auto;
        overflow-y: auto;
        flex: 1;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      thead th {
        font-weight: 600;
        text-align: left;
        padding: 10px;
        border-bottom: 1px solid #e6e6e6;
        color: #6b7280;
        position: sticky;
        top: 0;
        background: #fff;
        z-index: 10;
      }

      tbody tr {
        border-bottom: 1px solid #f4f4f4;
      }

      tbody tr.editing-row {
        background: #fbfdff;
      }

      td {
        padding: 8px 10px;
        vertical-align: top;
      }

      .chip {
        display: inline-block;
        background: #f3f4f6;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 12px;
        margin-right: 4px;
        margin-bottom: 3px;
        white-space: nowrap;
      }

      .chip.removable {
        cursor: pointer;
        padding-right: 4px;
      }

      .chip.removable:hover {
        filter: brightness(0.92);
      }

      .chip-remove {
        margin-left: 3px;
        font-weight: bold;
        color: #888;
      }

      .small {
        font-size: 12px;
        color: #6b7280;
      }

      .actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .action-btn {
        border: 1px solid #e6e6e6;
        background: #fff;
        padding: 5px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.82rem;
        white-space: nowrap;
      }

      .action-btn:hover {
        background: #f9fafb;
      }

      .nowrap {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 300px;
      }

      /* Inline edit inputs */
      .inline-input {
        width: 100%;
        padding: 5px 7px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
        box-sizing: border-box;
      }

      .inline-select {
        padding: 5px 7px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
      }

      .load-btn {
        padding: 5px 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background: #f9fafb;
        cursor: pointer;
        font-size: 12px;
        white-space: nowrap;
      }

      /* States layout — fetch + display on same horizontal line */
      .states-row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 6px;
      }

      .states-section {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 3px;
      }

      .states-label {
        font-size: 11px;
        color: #9ca3af;
        font-weight: 600;
        white-space: nowrap;
        margin-right: 2px;
      }

      .states-divider {
        width: 1px;
        height: 16px;
        background: #e5e7eb;
        align-self: center;
        flex-shrink: 0;
      }

      /* Edit-mode chip editor */
      .chip-editor {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        margin-bottom: 4px;
        min-height: 22px;
      }

      .add-chip-select {
        padding: 4px 6px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        max-width: 200px;
      }

      .add-chip-input {
        padding: 4px 6px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        width: 160px;
      }

      .edit-states-row {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }

      .edit-state-section {
        min-width: 180px;
      }

      .edit-state-section-title {
        font-size: 11px;
        color: #6b7280;
        font-weight: 600;
        margin-bottom: 3px;
      }

      .edit-meta-hint {
        font-size: 11px;
        color: #9ca3af;
        margin-top: 2px;
      }

      .browse-error {
        color: #dc2626;
        font-size: 12px;
      }

      /* Browse panel */
      .browse-panel {
        border: 1px solid #e6e6e6;
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 10px;
        background: #f9fafb;
      }

      .browse-panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.88rem;
        color: #374151;
      }

      .browse-panel-body {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .browse-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .browse-select {
        padding: 6px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
        min-width: 220px;
      }

      .area-path-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid #e6e6e6;
        border-radius: 4px;
        padding: 4px;
        background: #fff;
      }

      .area-path-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 6px;
        border-radius: 4px;
        font-size: 13px;
      }

      .area-path-row:hover {
        background: #f3f4f6;
      }

      .area-path-name {
        flex: 1;
        font-family: monospace;
        font-size: 12px;
        color: #374151;
      }
      /* Drag handle and reorder visuals */
      .drag-handle {
        width: 36px;
        text-align: center;
        cursor: grab;
        user-select: none;
        font-size: 16px;
        color: #9ca3af;
      }

      tbody tr.dragging {
        opacity: 0.5;
      }

      tbody tr.drag-over {
        outline: 2px dashed #3b82f6;
        background: #f3f9ff;
      }
`;
