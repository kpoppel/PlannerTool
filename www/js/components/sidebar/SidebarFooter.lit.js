import { LitElement, html, css } from '../../vendor/lit.js';
import { sel } from '../../application/imports.js';
import { StoreController } from '../../core/StoreController.js';
import { dataService } from '../../services/dataService.js';

export function renderSidebarFooter({ model }) {
  return html`
    <footer class="sidebar-config" role="contentinfo" aria-label="Application status">
      <div class="sidebar-footer-box">
        <div class="footer-line status">
          ${model.serverName ? model.serverName + ' | ' : ''}${model.serverStatus}
        </div>
        <div class="footer-line"
          title="Unique tasks across all retrieved plans, including hierarchy context for relationships and capacity/cost calculations; not the current scope or shown count">
          Loaded dataset: ${model.resolvedTasksCount} tasks
        </div>
        <div class="footer-line author">PlannerTool (C) 2025-2026 Kim Poulsen</div>
      </div>
    </footer>
  `;
}

export class AppFooter extends LitElement {
  static properties = { serverName: { state: true }, serverStatus: { state: true } };

  static styles = css`
    :host { display: block; position: fixed; bottom: 0; left: 0;
      width: var(--sidebar-width, 320px); height: var(--app-footer-height, 64px);
      z-index: var(--z-footer, 111); font-family: inherit;
      background: var(--color-sidebar-bg); color: var(--color-sidebar-text); }
    .sidebar-config { height: 100%; padding: 0 6px; box-sizing: border-box;
      display: flex; align-items: center; }
    .sidebar-footer-box { width: 100%; min-width: 0; border: 1px solid #ffffff10;
      border-radius: 6px; padding: 6px 8px; box-sizing: border-box; }
    .footer-line { font-size: 12px; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; line-height: 1.2; }
    .author { font-size: 11px; opacity: 0.85; }
  `;

  constructor() {
    super();
    this.serverName = '';
    this.serverStatus = 'Loading...';
    this._healthRequest = 0;
    this._store = new StoreController(this, (state) =>
      [state.baseline, state.selection, state.scenarios, state.view, state.lifecycle],
    { equalityFn: (previous, next) => previous.every((value, index) => value === next[index]) });
  }

  connectedCallback() {
    super.connectedCallback();
    this.refreshServerStatus();
  }

  disconnectedCallback() {
    this._healthRequest += 1;
    super.disconnectedCallback();
  }

  async refreshServerStatus() {
    const request = ++this._healthRequest;
    const isCurrent = () => this.isConnected && request === this._healthRequest;
    try {
      const result = await dataService.checkHealth();
      if (!isCurrent()) return;
      if (!result.ok) {
        console.error('[AppFooter] Health check failed', result.error);
        this.serverStatus = 'Server: error';
      } else {
        const health = result.data;
        const totalMinutes = Math.floor(health.uptime_seconds / 60);
        this.serverName = health.server_name;
        this.serverStatus = `${health.version} | Server: ${health.status} - Uptime: ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error('[AppFooter] Failed to refresh server status', error);
      this.serverStatus = 'Server: error';
    }
  }

  render() {
    return renderSidebarFooter({ model: { serverName: this.serverName,
      serverStatus: this.serverStatus,
      resolvedTasksCount: this._store.value[4].status === 'ready'
        ? sel.scope.getResolvedFeatures().length : 0 } });
  }
}

customElements.define('app-footer', AppFooter);

export function initAppFooter() {
  // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
  if (document.querySelector('app-footer') === null) {
    document.body.appendChild(document.createElement('app-footer'));
  }
}