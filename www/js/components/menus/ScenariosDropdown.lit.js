import { PopoverBase } from './PopoverBase.lit.js';
import { html, css } from '../../vendor/lit.js';
import { state } from '../../services/State.js';
import { bus } from '../../core/EventBus.js';
import { ScenarioEvents } from '../../core/EventRegistry.js';
import { dataService } from '../../services/dataService.js';

/**
 * ScenariosDropdown - Dropdown component for scenario management
 */
export class ScenariosDropdown extends PopoverBase {
  static properties = {
    ...PopoverBase.properties,
    scenarios: { type: Array },
    activeScenarioId: { type: String }
  };

  static styles = [
    PopoverBase.styles,
    css`
      :host {
        color: #222;
      }

      .popover-container {
        background: #fff !important;
        color: #222 !important;
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 6px 18px rgba(0,0,0,0.18);
      }

      .scenarios-list {
        color: #222;
      }

      .scenario-item {
        display: flex;
        align-items: center;
        padding: 0px 4px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.2s;
        gap: 8px;
        margin: 0 4px;
        color: #222 !important;
      }

      .scenario-item:hover {
        background: #f3f5f7;
      }

      .scenario-item.active {
        background: #e8f0fe;
        font-weight: 600;
      }

      .scenario-name {
        flex: 1;
        color: #222 !important;
      }

      .scenario-warning {
        color: #ff9900;
        font-size: 14px;
      }

      .scenario-controls {
        opacity: 0;
        transition: opacity 0.2s;
      }

      .scenario-item:hover .scenario-controls {
        opacity: 1;
      }

      .context-menu-btn {
        background: none;
        border: none;
        color: #666;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 16px;
      }

      .context-menu-btn:hover {
        background: rgba(0, 0, 0, 0.08);
        color: #222;
      }

      .actions-section {
        border-top: 1px solid rgba(0, 0, 0, 0.12);
        margin-top: 8px;
        padding-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .action-button {
        background: #f7f7f7;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 4px;
        padding: 8px 12px;
        color: #222;
        cursor: pointer;
        text-align: left;
        transition: background 0.2s;
      }

      .action-button:hover {
        background: #ececec;
      }
    `
  ];

  constructor() {
    super();
    this.scenarios = [];
    this.activeScenarioId = null;
    this._onScenariosChanged = this._onScenariosChanged.bind(this);
    this._onScenarioActivated = this._onScenarioActivated.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    bus.on(ScenarioEvents.LIST, this._onScenariosChanged);
    bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    this._loadScenarios();
  }

  disconnectedCallback() {
    bus.off(ScenarioEvents.LIST, this._onScenariosChanged);
    bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    super.disconnectedCallback();
  }

  _onScenariosChanged(data) {
    // ScenarioEvents.LIST provides { scenarios: [...], activeScenarioId }
    if (data && Array.isArray(data.scenarios)) {
      this.scenarios = data.scenarios;
      if (data.activeScenarioId) {
        this.activeScenarioId = data.activeScenarioId;
      }
    } else {
      // Fallback to state if payload is unexpected
      this.scenarios = state.scenarios || [];
      this.activeScenarioId = state.activeScenarioId;
    }
    this.requestUpdate();
  }

  _onScenarioActivated(data) {
    this.activeScenarioId = data?.scenarioId || state.activeScenarioId;
    this.requestUpdate();
  }

  async _loadScenarios() {
    // Request initial scenario list
    state.emitScenarioList();
  }

  async _onScenarioClick(scenario) {
    try {
      await state.activateScenario(scenario.id);
      this.close();
    } catch (err) {
      console.error('Failed to activate scenario:', err);
    }
  }

  async _onCloneScenario() {
    try {
      const { openScenarioCloneModal } = await import('../modalHelpers.js');
      const defaultName = this._generateDefaultScenarioName();
      const activeScenario = this.scenarios.find(s => s.id === this.activeScenarioId);
      await openScenarioCloneModal({ id: activeScenario?.id, name: defaultName });
      this.close();
    } catch (err) {
      console.error('Failed to clone scenario:', err);
    }
  }

  async _onSaveScenario() {
    try {
      const activeScenario = this.scenarios.find(s => s.id === this.activeScenarioId);
      if (activeScenario && !activeScenario.readonly) {
        await state.saveScenario(activeScenario.id);
      }
      this.close();
    } catch (err) {
      console.error('Failed to save scenario:', err);
    }
  }

  _generateDefaultScenarioName() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const maxN = Math.max(
      0,
      ...(this.scenarios || [])
        .map(sc => /^\d{2}-\d{2} Scenario (\d+)$/i.exec(sc.name)?.[1])
        .filter(Boolean)
        .map(n => parseInt(n, 10))
    );
    return `${mm}-${dd} Scenario ${maxN + 1}`;
  }

  async _onScenarioMenuClick(e, scenario) {
    e.stopPropagation();
    
    document.querySelectorAll('.scenario-menu-popover').forEach(p => p.remove());
    
    const menuBtn = e.currentTarget;
    const pop = document.createElement('div');
    pop.className = 'scenario-menu-popover';
    
    const addItem = (label, emoji, onClick, disabled = false) => {
      const item = document.createElement('div');
      item.className = 'scenario-menu-item';
      if (disabled) item.classList.add('disabled');
      item.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
      if (!disabled) {
        item.addEventListener('click', ev => {
          ev.stopPropagation();
          onClick();
          pop.remove();
        });
      }
      pop.appendChild(item);
    };
    
    const defaultCloneName = this._generateDefaultScenarioName();
    
    addItem('Clone Scenario', '⎘', async () => {
      const { openScenarioCloneModal } = await import('../modalHelpers.js');
      await openScenarioCloneModal({ id: scenario.id, name: defaultCloneName });
    });
    
    if (scenario.readonly) {
      addItem('Refresh Baseline', '🔄', () => state.refreshBaseline());
    } else {
      addItem('Rename', '✏️', async () => {
        const { openScenarioRenameModal } = await import('../modalHelpers.js');
        await openScenarioRenameModal({ id: scenario.id, name: scenario.name });
      });
      
      addItem('Delete', '🗑️', async () => {
        const { openScenarioDeleteModal } = await import('../modalHelpers.js');
        await openScenarioDeleteModal({ id: scenario.id, name: scenario.name });
      });
      
      addItem('Save Scenario', '💾', () => state.saveScenario(scenario.id));
      
      addItem(
        'Save to Azure DevOps',
        '💾',
        async () => {
          const overrideEntries = Object.entries(scenario.overrides || {});
          if (overrideEntries.length === 0) return;
          const { openAzureDevopsModal } = await import('../modalHelpers.js');
          const selected = await openAzureDevopsModal({ overrides: scenario.overrides, state });
          if (selected?.length) await dataService.publishBaseline(selected);
        },
        scenario.overrides && Object.keys(scenario.overrides).length === 0
      );
    }
    
    const rect = menuBtn.getBoundingClientRect();
    Object.assign(pop.style, {
      position: 'absolute',
      top: `${rect.top + window.scrollY + rect.height + 4}px`,
      left: `${rect.left + window.scrollX - 20}px`,
      background: '#fff',
      color: '#222',
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '6px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
      minWidth: '160px',
      zIndex: '2000'
    });
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  }

  renderContent() {
    const sorted = [...(this.scenarios || [])].sort((a, b) => {
      if (a.readonly && !b.readonly) return -1;
      if (b.readonly && !a.readonly) return 1;
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });

    return html`
      <div class="scenarios-list">
        ${sorted.map(
          scenario => html`
            <div
              class="scenario-item ${scenario.id === this.activeScenarioId ? 'active' : ''}"
              @click=${() => this._onScenarioClick(scenario)}>
              <span class="scenario-name">${scenario.name}</span>
              ${scenario.unsaved
                ? html`<span class="scenario-warning" title="Unsaved">⚠️</span>`
                : ''}
              <span class="scenario-controls">
                <button
                  class="context-menu-btn"
                  @click=${e => this._onScenarioMenuClick(e, scenario)}
                  title="Scenario actions">
                  ⋯
                </button>
              </span>
            </div>
          `
        )}
      </div>
      
      <div class="actions-section">
        <button class="action-button" @click=${() => this._onCloneScenario()}>
          Copy selected to new scenario
        </button>
        <button class="action-button" @click=${() => this._onSaveScenario()}>
          Save scenario
        </button>
      </div>
    `;
  }
}

customElements.define('scenarios-dropdown', ScenariosDropdown);
