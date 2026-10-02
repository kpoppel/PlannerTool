import { html } from '../../vendor/lit.js';

export function renderSidebarFooter({ model }) {
  return html`
    <div class="sidebar-config">
      <div class="sidebar-footer-box">
        <div class="footer-line status">
          ${model.serverName ? model.serverName + ' | ' : ''}${model.serverStatus}
        </div>
        <div class="footer-line">Tasks loaded: ${model.resolvedTasksCount}</div>
        <div class="footer-line author">PlannerTool (C) 2025-2026 Kim Poulsen</div>
      </div>
    </div>
  `;
}