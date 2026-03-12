import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { ScenarioEvents, DataEvents } from '../core/EventRegistry.js';

/**
 * ScenarioMenu - Dropdown menu for Scenarios
 * Shows scenarios with action buttons
 */
export class ScenarioMenuLit extends LitElement {
  static properties = {
    scenarios: { type: Array },
    activeScenarioId: { type: String },
  };

  static styles = css`
    :host {
      display: block;
    }

    .menu-popover {
      background: var(--color-sidebar-bg);
      color: var(--color-sidebar-text);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      min-width: 280px;
      max-width: 400px;
      max-height: 500px;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sidebar-list { 
      list-style:none; 
      padding:0; 
      display:flex; 
      flex-direction:column; 
      gap:4px; 
      margin:0; 
    }
    
    .sidebar-list-item { display:block; }
    
    .scenario-item { 
      padding:4px 6px; 
      border-radius:6px; 
      width:100%; 
      display:flex; 
      align-items:center; 
      gap:8px; 
      box-sizing:border-box; 
      position:relative; 
    }
    
    .scenario-item.active { 
      background:rgba(255,255,255,0.18); 
    }
    
    .scenario-name { 
      cursor:pointer; 
      flex:1 1 auto; 
      font-weight:600; 
      font-size:0.85rem; 
      overflow:hidden; 
      text-overflow:ellipsis; 
      white-space:nowrap; 
      padding-right:56px; 
    }
    
    .scenario-warning {
      font-size: 0.9rem;
      margin-right: 4px;
    }
    
    .scenario-controls { 
      display:inline-flex; 
      gap:4px; 
      align-items:center; 
      position:absolute; 
      right:6px; 
      top:50%; 
      transform:translateY(-50%); 
    }
    
    .scenario-btn { 
      background:#f7f7f7; 
      border:1px solid var(--color-border, #ccc); 
      border-radius:4px; 
      padding:2px 6px; 
      cursor:pointer; 
      font-size:0.75rem; 
      line-height:1; 
      color: #333;
    }
    
    .scenario-btn:hover { 
      background:#ececec; 
    }
  `;

  constructor() {
    super();
    this.scenarios = [];
    this.activeScenarioId = null;
  }

  connectedCallback() {
    super.connectedCallback();
    
    // Listen to scenario changes for real-time updates
    this._onScenariosList = (payload) => {
      this.scenarios = payload?.scenarios ? [...payload.scenarios] : [];
      this.activeScenarioId = payload?.activeId || null;
      this.requestUpdate();
    };
    
    this._onScenarioActivated = (payload) => {
      this.activeScenarioId = payload?.id || null;
      this.requestUpdate();
    };
    
    this._onScenariosUpdated = () => {
      try {
        const scenarios = state.getScenarios?.() || [];
        this.scenarios = scenarios ? [...scenarios] : [];
        this.requestUpdate();
      } catch (e) { /* ignore */ }
    };

    bus.on(ScenarioEvents.LIST, this._onScenariosList);
    bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    bus.on(ScenarioEvents.UPDATED, this._onScenariosUpdated);
    bus.on(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);

    // Don't initialize from state - scenarios are passed as properties from TopMenu
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onScenariosList) bus.off(ScenarioEvents.LIST, this._onScenariosList);
    if (this._onScenarioActivated) bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    if (this._onScenariosUpdated) {
      bus.off(ScenarioEvents.UPDATED, this._onScenariosUpdated);
      bus.off(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    }
  }

  _onScenarioClick(e, scenario) {
    if (!e.target.closest('.scenario-controls')) {
      state.activateScenario(scenario.id);
    }
  }

  _onScenarioMenuClick(e, scenario) {
    e.stopPropagation();
    
    // Dispatch event to parent/app to show scenario menu
    this.dispatchEvent(new CustomEvent('scenario-menu', {
      detail: { scenario, sourceEvent: e },
      bubbles: true,
      composed: true
    }));
  }

  render() {
    const sorted = [...(this.scenarios || [])].sort((a, b) => {
      if (a.readonly && !b.readonly) return -1;
      if (!a.readonly && b.readonly) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    return html`
      <div class="menu-popover">
        <ul class="sidebar-list">
          ${sorted.map(s => html`
            <li class="sidebar-list-item scenario-item ${s.id === this.activeScenarioId ? 'active' : ''}" 
                @click=${(e) => this._onScenarioClick(e, s)}>
              <span class="scenario-name" title="${s.name}">${s.name}</span>
              ${state.isScenarioUnsaved?.(s) ? html`
                <span class="scenario-warning" title="Unsaved">⚠️</span>
              ` : ''}
              <span class="scenario-controls">
                <button type="button" 
                        class="scenario-btn" 
                        title="Scenario actions" 
                        @click=${(e) => this._onScenarioMenuClick(e, s)}>⋯</button>
              </span>
            </li>
          `)}
        </ul>
      </div>
    `;
  }
}

customElements.define('scenario-menu', ScenarioMenuLit);
