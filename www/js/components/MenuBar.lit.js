import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import { ViewManagementEvents, ScenarioEvents, PluginEvents, ProjectEvents, TeamEvents } from '../core/EventRegistry.js';

/**
 * MenuBar - Top menu bar containing Views, Scenarios, Tools, Plans, and Allocation controls
 */
export class MenuBar extends LitElement {
  static properties = {
    activeView: { type: Object },
    activeScenario: { type: Object },
    activePlugin: { type: String }
  };

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: var(--sidebar-width, 368px);
      right: 0;
      height: var(--menu-bar-height, 32px);
      z-index: 100;
      background: var(--color-sidebar-bg, rgb(55, 85, 130));
      border-bottom: 1px solid rgba(0, 0, 0, 0.2);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .menu-bar-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 100%;
      padding: 0 16px;
      gap: 16px;
    }

    .menu-section-left,
    .menu-section-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .menu-button {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 4px 12px;
      color: var(--color-sidebar-text, #fff);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
      white-space: nowrap;
    }

    .menu-button:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .menu-button:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .menu-button.active {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .menu-icon-button {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
    }

    .menu-icon-button:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .warning-indicator {
      color: #ffcc00;
      margin-left: 4px;
      font-size: 12px;
    }
  `;

  constructor() {
    super();
    this.activeView = { name: 'Default View' };
    this.activeScenario = { name: 'Default Scenario' };
    this.activePlugin = null;

    this._onViewActivated = this._onViewActivated.bind(this);
    this._onScenarioActivated = this._onScenarioActivated.bind(this);
    this._onPluginActivated = this._onPluginActivated.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);
    bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    bus.on(PluginEvents.ACTIVATED, this._onPluginActivated);
    bus.on(PluginEvents.DEACTIVATED, () => {
      this.activePlugin = null;
      this.requestUpdate();
    });
  }

  disconnectedCallback() {
    bus.off(ViewManagementEvents.ACTIVATED, this._onViewActivated);
    bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    bus.off(PluginEvents.ACTIVATED, this._onPluginActivated);
    super.disconnectedCallback();
  }

  _onViewActivated(data) {
    this.activeView = data.view || { name: 'Default View' };
    this.requestUpdate();
  }

  _onScenarioActivated(data) {
    this.activeScenario = data || { name: 'Default Scenario' };
    this.requestUpdate();
  }

  _onPluginActivated(data) {
    this.activePlugin = data.id || null;
    this.requestUpdate();
  }

  _handleViewsClick(e) {
    const viewsDropdown = document.querySelector('views-dropdown');
    if (viewsDropdown) {
      viewsDropdown.toggle(e.currentTarget);
    }
  }

  _handleScenariosClick(e) {
    const scenariosDropdown = document.querySelector('scenarios-dropdown');
    if (scenariosDropdown) {
      scenariosDropdown.toggle(e.currentTarget);
    }
  }

  _handleToolsClick(e) {
    const toolsPopover = document.querySelector('tools-popover');
    if (toolsPopover) {
      toolsPopover.toggle(e.currentTarget);
    }
  }

  _handlePlansClick(e) {
    const plansPopover = document.querySelector('plans-popover');
    if (plansPopover) {
      plansPopover.toggle(e.currentTarget);
    }
  }

  _handleAllocationClick(e) {
    const allocationPopover = document.querySelector('allocation-popover');
    if (allocationPopover) {
      allocationPopover.toggle(e.currentTarget);
    }
  }

  _handleConfigClick() {
    // Dispatch custom event that Sidebar or main app can listen to
    this.dispatchEvent(new CustomEvent('config-clicked', { bubbles: true, composed: true }));
  }

  _handleHelpClick() {
    // Dispatch custom event that Sidebar or main app can listen to
    this.dispatchEvent(new CustomEvent('help-clicked', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="menu-bar-container">
        <div class="menu-section-left">
          <button 
            class="menu-button" 
            @click=${this._handleViewsClick}
            title="Manage views">
            Views: ${this.activeView?.name || 'Default View'}
          </button>
          
          <button 
            class="menu-button" 
            @click=${this._handleScenariosClick}
            title="Manage scenarios">
            Scenarios: ${this.activeScenario?.name || 'Default Scenario'}
            ${this.activeScenario?.unsaved ? html`<span class="warning-indicator">⚠️</span>` : ''}
          </button>
          
          <button 
            class="menu-button ${this.activePlugin ? 'active' : ''}" 
            @click=${this._handleToolsClick}
            title="Tools and plugins">
            Tools
          </button>
          
          <button 
            class="menu-button" 
            @click=${this._handlePlansClick}
            title="Select plans">
            Plans
          </button>
          
          <button 
            class="menu-button" 
            @click=${this._handleAllocationClick}
            title="Select team allocations">
            Teams
          </button>
        </div>

        <div class="menu-section-right">
          <button 
            class="menu-icon-button" 
            @click=${this._handleConfigClick}
            title="Configuration">
            ⚙️
          </button>
          
          <button 
            class="menu-icon-button" 
            @click=${this._handleHelpClick}
            title="Help">
            ❓
          </button>
        </div>
      </div>
    `;
  }
}

customElements.define('app-menu-bar', MenuBar);
