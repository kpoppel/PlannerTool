import { LitElement, html, css } from '../vendor/lit.js';
import { dataService } from '../services/dataService.js';
import { cmd, sel } from '../application/imports.js';
import { bus } from '../core/EventBus.js';
import { ScenarioEvents, DataEvents } from '../core/EventRegistry.js';
import { publishScenario } from './scenarioPublication.js';

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
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
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
      list-style: none;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0 0 8px 0;
    }

    .sidebar-list-item {
      display: block;
    }

    .scenario-item {
      padding: 8px 10px;
      border-radius: 6px;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      position: relative;
      cursor: pointer;
      transition: background 120ms ease;
    }

    .scenario-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .scenario-item.active {
      background: rgba(255, 255, 255, 0.18);
    }

    .scenario-item.active:hover {
      background: rgba(255, 255, 255, 0.22);
    }

    .scenario-name {
      flex: 1 1 auto;
      font-weight: 600;
      font-size: 0.85rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-right: 4px;
    }

    .scenario-warning {
      font-size: 0.9rem;
      margin-right: 4px;
      opacity: 0.85;
    }

    .scenario-actions {
      display: inline-flex;
      gap: 2px;
      align-items: center;
      opacity: 1;
      transition: opacity 120ms ease;
    }

    .action-btn {
      background: transparent;
      border: none;
      border-radius: 3px;
      padding: 4px 6px;
      cursor: pointer;
      font-size: 0.8rem;
      line-height: 1;
      color: var(--color-sidebar-text);
      transition: background 100ms ease;
      opacity: 0.7;
    }

    .action-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      opacity: 1;
    }

    .action-btn:active {
      background: rgba(255, 255, 255, 0.25);
    }

    .copy-scenario-btn {
      width: 100%;
      padding: 8px 12px;
      background: rgba(102, 126, 234, 0.2);
      border: 1px solid rgba(102, 126, 234, 0.4);
      border-radius: 6px;
      color: var(--color-sidebar-text);
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      text-align: center;
      transition: all 0.15s;
      margin-top: 4px;
    }

    .copy-scenario-btn:hover {
      background: rgba(102, 126, 234, 0.35);
      border-color: rgba(102, 126, 234, 0.6);
    }
  `;

  constructor() {
    super();
    this.scenarios = [];
    this.activeScenarioId = null;
  }

  connectedCallback() {
    super.connectedCallback();

    // Listen to scenario changes for real-time updates.
    // Do not silently hide state failures by falling back to stale event payloads.
    this._onScenariosList = () => {
      const full = sel.scenario.getScenarios();
      if (!Array.isArray(full)) {
        throw new Error('ScenarioMenu expected a valid scenario list from the store');
      }

      this.scenarios = [...full];
      this.activeScenarioId = sel.scenario.getActiveScenarioId();
      this.requestUpdate();
    };

    this._onScenarioActivated = () => {
      this.activeScenarioId = sel.scenario.getActiveScenarioId();
      this.requestUpdate();
    };

    this._onScenariosUpdated = () => {
      const scenarios = sel.scenario.getScenarios();
      this.scenarios = [...scenarios];
      this.activeScenarioId = sel.scenario.getActiveScenarioId();
      this.requestUpdate();
    };

    bus.on(ScenarioEvents.LIST, this._onScenariosList);
    bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    bus.on(ScenarioEvents.UPDATED, this._onScenariosUpdated);
    bus.on(DataEvents.SCENARIOS_CHANGED, this._onScenariosUpdated);
    bus.on(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);

    // Initialize from current state/props in case events were emitted before
    // this popover was connected.
    this._onScenariosList();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onScenariosList) bus.off(ScenarioEvents.LIST, this._onScenariosList);
    if (this._onScenarioActivated)
      bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    if (this._onScenariosUpdated) {
      bus.off(ScenarioEvents.UPDATED, this._onScenariosUpdated);
      bus.off(DataEvents.SCENARIOS_CHANGED, this._onScenariosUpdated);
      bus.off(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    }
  }

  _onScenarioClick(e, scenario) {
    e.stopPropagation();
    // Activate the scenario
    cmd.scenario.activateScenario(scenario.id);
  }

  async _onSaveScenario(e, scenario) {
    e.stopPropagation();
    try {
      const scenarios = sel.scenario.getScenarios();
      if (!Array.isArray(scenarios)) {
        throw new Error('ScenarioMenu expected a valid scenario list from the store');
      }

      if (!sel.scenario.getScenarioAccess(scenario.id).canEdit) return;
      await cmd.scenario.saveScenario(scenario.id);
      this.requestUpdate();
      console.log('[ScenarioMenu] Saved scenario:', scenario.name, sel.scenario.getChangedScenarioIds());
    } catch (err) {
      console.error('[ScenarioMenu] Failed to save scenario:', scenario.name, err);
      throw err;
    }
  }

  async _onCloneScenario(e, scenario) {
    e.stopPropagation();
    try {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const scenarios = sel.scenario.getScenarios() || [];
      const maxN = Math.max(
        0,
        ...scenarios
          .map((sc) => /^\d{2}-\d{2} Scenario (\d+)$/i.exec(sc.name)?.[1])
          .filter(Boolean)
          .map((n) => parseInt(n, 10))
      );
      const defaultCloneName = `${mm}-${dd} Scenario ${maxN + 1}`;

      const { openScenarioCloneModal } = await import('./modalHelpers.js');
      await openScenarioCloneModal({ id: scenario.id, name: defaultCloneName });
    } catch (err) {
      console.error('[ScenarioMenu] Failed to clone scenario:', err);
    }
  }

  async _onRenameScenario(e, scenario) {
    e.stopPropagation();
    if (!sel.scenario.getScenarioAccess(scenario.id).canEdit) return;
    try {
      const { openScenarioRenameModal } = await import('./modalHelpers.js');
      await openScenarioRenameModal({ id: scenario.id, name: scenario.name });
    } catch (err) {
      console.error('[ScenarioMenu] Failed to open rename modal:', err);
    }
  }

  async _onDeleteScenario(e, scenario) {
    e.stopPropagation();
    if (!sel.scenario.getScenarioAccess(scenario.id).canEdit) return;
    try {
      const { openScenarioDeleteModal } = await import('./modalHelpers.js');
      await openScenarioDeleteModal({ id: scenario.id, name: scenario.name });
    } catch (err) {
      console.error('[ScenarioMenu] Failed to open delete modal:', err);
    }
  }

  async _onRefreshBaseline(e, scenario) {
    e.stopPropagation();
    if (scenario.id !== 'baseline') return;
    try {
      const result = await cmd.scenario.requestBaselineRefresh();
      if (!result.ok) throw new Error(result.error.message);
      console.log('[ScenarioMenu] Requested background baseline refresh');
    } catch (err) {
      console.error('[ScenarioMenu] Failed to refresh baseline:', err);
    }
  }

  _getChangedScenarioIds() {
    return new Set(sel.scenario.getChangedScenarioIds().map(String));
  }

  async _onCopyScenario(e) {
    e.stopPropagation();
    try {
      // Copy the active scenario
      const activeScenario = this.scenarios?.find((s) => s.id === this.activeScenarioId);
      if (!activeScenario) {
        console.warn('[ScenarioMenu] No active scenario to copy');
        return;
      }

      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const scenarios = sel.scenario.getScenarios() || [];
      const maxN = Math.max(
        0,
        ...scenarios
          .map((sc) => /^\d{2}-\d{2} Scenario (\d+)$/i.exec(sc.name)?.[1])
          .filter(Boolean)
          .map((n) => parseInt(n, 10))
      );
      const defaultCloneName = `${mm}-${dd} Scenario ${maxN + 1}`;

      const { openScenarioCloneModal } = await import('./modalHelpers.js');
      await openScenarioCloneModal({
        id: activeScenario.id,
        name: defaultCloneName,
      });
    } catch (err) {
      console.error('[ScenarioMenu] Failed to copy scenario:', err);
    }
  }

  async _onPublishScenario(e, scenario) {
    e.stopPropagation();
    return publishScenario(scenario);
  }

  render() {
    const sorted = [...(this.scenarios || [])].sort((a, b) => {
      if (a.id === 'baseline') return -1;
      if (b.id === 'baseline') return 1;
      if (a.readonly && !b.readonly) return -1;
      if (!a.readonly && b.readonly) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    const changedScenarioIds = this._getChangedScenarioIds();
    console.log('[ScenarioMenu] Rendering scenarios', sorted.map((s) => s.name), changedScenarioIds);
    return html`
      <div class="menu-popover">
        <ul class="sidebar-list">
          ${sorted.map(
            (s) => {
              const hasUnsavedChanges = changedScenarioIds.has(String(s.id));
              //console.log('[ScenarioMenu] Rendering scenarios inder', s.name, hasUnsavedChanges);
              return html`
              <li
                class="sidebar-list-item scenario-item ${s.id === this.activeScenarioId ?
                  'active'
                : ''}"
                @click=${(e) => this._onScenarioClick(e, s)}
              >
                <span class="scenario-name" title="${s.name}">${s.name}</span>
                ${hasUnsavedChanges ?
                  html` <span class="scenario-warning" title="Unsaved changes">⚠️</span> `
                : ''}
                ${s.id === 'baseline' ?
                  html`
                    <span class="scenario-actions">
                      <button
                        type="button"
                        class="action-btn"
                        title="Refresh baseline data"
                        @click=${(e) => this._onRefreshBaseline(e, s)}
                      >
                        🔄
                      </button>
                    </span>
                  `
                : !sel.scenario.getScenarioAccess(s.id).canEdit ? '' : html`
                  <span class="scenario-actions">
                      <button
                        type="button"
                        class="action-btn"
                        title="Save scenario changes"
                        @click=${(e) => this._onSaveScenario(e, s)}
                      >
                        💾
                      </button>
                      ${s.id === this.activeScenarioId &&
                        (
                          (s.overrides && Object.keys(s.overrides).length > 0) ||
                          s.overridesCount > 0 ||
                          sel.group.getPendingGroupChanges?.().length > 0
                        ) ?
                        html`
                          <button
                            type="button"
                            class="action-btn"
                            title="Publish scenario"
                            @click=${(e) => this._onPublishScenario(e, s)}
                          >
                            ☁️
                          </button>
                        `
                      : ''}
                      <button
                        type="button"
                        class="action-btn"
                        title="Rename scenario"
                        @click=${(e) => this._onRenameScenario(e, s)}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        class="action-btn"
                        title="Delete scenario"
                        @click=${(e) => this._onDeleteScenario(e, s)}
                      >
                        🗑️
                      </button>
                    </span>
                  `}
              </li>
            `;
            })
          }
        </ul>
        <button type="button" class="copy-scenario-btn" @click=${this._onCopyScenario}>
          📋 Copy Scenario
        </button>
      </div>
    `;
  }
}

customElements.define('scenario-menu', ScenarioMenuLit);
