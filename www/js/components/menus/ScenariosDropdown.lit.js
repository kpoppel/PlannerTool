import { PopoverBase } from './PopoverBase.lit.js';
import { html, css } from '../../vendor/lit.js';
import { state } from '../../services/State.js';
import { bus } from '../../core/EventBus.js';
import { ScenarioEvents } from '../../core/EventRegistry.js';
import { dataService } from '../../services/dataService.js';
import { saveIconTemplate, cloneIconTemplate, editIconTemplate, deleteIconTemplate, refreshIconTemplate, cloudIconTemplate } from '../../services/IconService.js';

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
        padding: 4px 8px;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.15s ease;
        gap: 8px;
        margin: 0 4px;
        color: #222 !important;
        min-height: 32px;
        border: 1px solid transparent;
      }

      .scenario-item:hover {
        background: #dfe4ea;
        border-color: rgba(0, 0, 0, 0.1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .scenario-item.active {
        background: #e8f0fe;
        font-weight: 600;
        border-color: rgba(66, 133, 244, 0.3);
      }

      .scenario-item.active:hover {
        background: #d2e3fc;
        border-color: rgba(66, 133, 244, 0.5);
        box-shadow: 0 1px 3px rgba(66, 133, 244, 0.2);
      }

      .scenario-name {
        flex: 1;
        color: #222 !important;
        padding: 4px 0;
      }

      .scenario-warning {
        color: #ff9900;
        font-size: 14px;
        margin-right: 4px;
      }

      .scenario-actions {
        display: flex;
        gap: 2px;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .scenario-item:hover .scenario-actions {
        opacity: 1;
      }

      .action-icon-btn {
        background: rgba(0, 0, 0, 0.05);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 4px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
        padding: 0;
      }

      .action-icon-btn svg {
        width: 16px;
        height: 16px;
        display: block;
      }

      .action-icon-btn:hover {
        background: rgba(0, 0, 0, 0.15);
        border-color: rgba(0, 0, 0, 0.25);
        transform: scale(1.05);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
      }

      .action-icon-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .action-icon-btn:disabled:hover {
        transform: none;
        background: rgba(0, 0, 0, 0.05);
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

  async _onCloneScenarioClick(e, scenario) {
    e.stopPropagation();
    const { openScenarioCloneModal } = await import('../modalHelpers.js');
    const defaultName = this._generateDefaultScenarioName();
    await openScenarioCloneModal({ id: scenario.id, name: defaultName });
  }

  async _onRefreshBaseline(e) {
    e.stopPropagation();
    state.refreshBaseline();
  }

  async _onRenameScenario(e, scenario) {
    e.stopPropagation();
    const { openScenarioRenameModal } = await import('../modalHelpers.js');
    await openScenarioRenameModal({ id: scenario.id, name: scenario.name });
  }

  async _onDeleteScenario(e, scenario) {
    e.stopPropagation();
    const { openScenarioDeleteModal } = await import('../modalHelpers.js');
    await openScenarioDeleteModal({ id: scenario.id, name: scenario.name });
  }

  async _onSaveScenario(e, scenario) {
    e.stopPropagation();
    await state.saveScenario(scenario.id);
  }

  async _onPublishToAzure(e, scenario) {
    e.stopPropagation();
    
    // Get overrides from state for active scenario to ensure we have current data
    let overrides = scenario.overrides;
    if (scenario.id === this.activeScenarioId) {
      const activeScenario = state.scenarios?.find(s => s.id === scenario.id);
      overrides = activeScenario?.overrides || {};
    }
    
    const overrideEntries = Object.entries(overrides || {});
    if (overrideEntries.length === 0) return;
    const { openAzureDevopsModal } = await import('../modalHelpers.js');
    const selected = await openAzureDevopsModal({ overrides, state });
    if (selected?.length) await dataService.publishBaseline(selected);
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
          scenario => {
            // For active scenario, get overrides from state; otherwise use scenario's overrides
            let hasOverrides = false;
            if (scenario.id === this.activeScenarioId) {
              const activeScenario = state.scenarios?.find(s => s.id === scenario.id);
              hasOverrides = activeScenario?.overrides && Object.keys(activeScenario.overrides).length > 0;
            } else {
              hasOverrides = scenario.overrides && Object.keys(scenario.overrides).length > 0;
            }
            return html`
              <div
                class="scenario-item ${scenario.id === this.activeScenarioId ? 'active' : ''}"
                @click=${() => this._onScenarioClick(scenario)}>
                <span class="scenario-name">${scenario.name}</span>
                ${scenario.unsaved
                  ? html`<span class="scenario-warning" title="Unsaved">⚠️</span>`
                  : ''}
                <div class="scenario-actions">
                  ${scenario.readonly
                    ? html`
                        <button
                          class="action-icon-btn"
                          @click=${e => this._onCloneScenarioClick(e, scenario)}
                          title="Clone Scenario">
                          ${cloneIconTemplate}
                        </button>
                        <button
                          class="action-icon-btn"
                          @click=${e => this._onRefreshBaseline(e)}
                          title="Refresh Baseline">
                          ${refreshIconTemplate}
                        </button>
                      `
                    : html`
                        <button
                          class="action-icon-btn"
                          @click=${e => this._onSaveScenario(e, scenario)}
                          title="Save Scenario">
                          ${saveIconTemplate}
                        </button>
                        <button
                          class="action-icon-btn"
                          @click=${e => this._onCloneScenarioClick(e, scenario)}
                          title="Clone Scenario">
                          ${cloneIconTemplate}
                        </button>
                        <button
                          class="action-icon-btn"
                          @click=${e => this._onRenameScenario(e, scenario)}
                          title="Rename">
                          ${editIconTemplate}
                        </button>
                        <button
                          class="action-icon-btn"
                          @click=${e => this._onDeleteScenario(e, scenario)}
                          title="Delete">
                          ${deleteIconTemplate}
                        </button>
                        <button
                          class="action-icon-btn"
                          @click=${e => this._onPublishToAzure(e, scenario)}
                          ?disabled=${!hasOverrides}
                          title="${hasOverrides ? 'Save to Azure DevOps' : 'No changes to publish'}">
                          ${cloudIconTemplate}
                        </button>
                      `}
                </div>
              </div>
            `;
          }
        )}
      </div>
    `;
  }
}

customElements.define('scenarios-dropdown', ScenariosDropdown);
