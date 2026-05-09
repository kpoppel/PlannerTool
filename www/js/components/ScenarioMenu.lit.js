import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { dataService } from '../services/dataService.js';
import { groupService } from '../services/GroupService.js';
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

    // Listen to scenario changes for real-time updates
    this._onScenariosList = (payload) => {
      // Use full scenarios from state to get overrides data
      try {
        const full = state.scenarios || [];
        this.scenarios = Array.isArray(full) ? [...full] : [];
      } catch (e) {
        // Fallback to payload if state is not ready
        const list = payload?.scenarios || [];
        this.scenarios = Array.isArray(list) ? [...list] : [];
      }
      this.activeScenarioId = payload?.activeScenarioId || null;
      this.requestUpdate();
    };

    this._onScenarioActivated = (payload) => {
      this.activeScenarioId = payload?.scenarioId || null;
      this.requestUpdate();
    };

    this._onScenariosUpdated = () => {
      const scenarios = state.getScenarios?.() || [];
      this.scenarios = scenarios ? [...scenarios] : [];
      this.requestUpdate();
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
    if (this._onScenarioActivated)
      bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    if (this._onScenariosUpdated) {
      bus.off(ScenarioEvents.UPDATED, this._onScenariosUpdated);
      bus.off(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    }
  }

  _onScenarioClick(e, scenario) {
    e.stopPropagation();
    // Activate the scenario
    state.activateScenario(scenario.id);
  }

  async _onSaveScenario(e, scenario) {
    e.stopPropagation();
    try {
      await state.saveScenario(scenario.id);
      console.log('[ScenarioMenu] Saved scenario:', scenario.name);
    } catch (err) {
      console.error('[ScenarioMenu] Failed to save scenario:', err);
    }
  }

  async _onCloneScenario(e, scenario) {
    e.stopPropagation();
    try {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const scenarios = state.getScenarios?.() || [];
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
    try {
      const { openScenarioRenameModal } = await import('./modalHelpers.js');
      await openScenarioRenameModal({ id: scenario.id, name: scenario.name });
    } catch (err) {
      console.error('[ScenarioMenu] Failed to open rename modal:', err);
    }
  }

  async _onDeleteScenario(e, scenario) {
    e.stopPropagation();
    try {
      const { openScenarioDeleteModal } = await import('./modalHelpers.js');
      await openScenarioDeleteModal({ id: scenario.id, name: scenario.name });
    } catch (err) {
      console.error('[ScenarioMenu] Failed to open delete modal:', err);
    }
  }

  async _onRefreshBaseline(e, scenario) {
    e.stopPropagation();
    try {
      // User explicitly requested a refresh — invalidate the server cache first
      // so stale data is not served, then reload.
      await state.invalidateAndRefreshBaseline();
      console.log('[ScenarioMenu] Refreshed baseline');
    } catch (err) {
      console.error('[ScenarioMenu] Failed to refresh baseline:', err);
    }
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
      const scenarios = state.getScenarios?.() || [];
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

  async _onSaveToAzure(e, scenario) {
    e.stopPropagation();
    try {
      const fullScenarios = state.getScenarios?.() || state.scenarios || [];
      const fullScenario = fullScenarios.find((s) => s.id === scenario.id) || scenario;

      const overrides = fullScenario.overrides || {};
      const pendingGroupChanges = state.getPendingGroupChanges();
      const hasFeatureChanges = Object.keys(overrides).length > 0;
      const hasGroupChanges = pendingGroupChanges.length > 0;

      if (!hasFeatureChanges && !hasGroupChanges) {
        console.log('[ScenarioMenu] No changes to save');
        return;
      }

      const { openAzureDevopsModal } = await import('./modalHelpers.js');
      const result = await openAzureDevopsModal({ overrides, pendingGroupChanges, state });
      if (!result) return; // user cancelled

      const { features = [], groupChanges = [] } = result;

      // 1. Persist accepted group changes.
      //    - create (from scenario.scenarioGroups): POST → get real ID → swap temp → remove from scenarioGroups
      //    - update (baseline group fields): PUT /api/groups/{id}
      //    - update with members (from groupOverrides): included in PUT payload
      //    - delete: DELETE /api/groups/{id} → remove from groupOverrides
      const affectedPlanIds = new Set();
      for (const op of groupChanges) {
        if (op.type === 'create' && op.group) {
          const allMembers = (op.group.members || []).map(String);
          const committedMembers = new Set((op.group.members || []).map(String));
          // op.group.members is already the filtered (selected) list from _onSave.
          // We need to know which members were in the original scenarioGroups entry
          // but NOT committed, so we can keep them as pending memberDeltas.
          const activeScen = state.getActiveScenario();
          const originalEntry = (activeScen?.scenarioGroups || [])
            .find((g) => String(g.id) === String(op.group.id));
          const allOriginalMembers = (originalEntry?.members || []).map(String);

          const payload = {
            plan_id: op.group.plan_id,
            name: op.group.name,
            color: op.group.color || null,
            rank: op.group.rank ?? 0,
            members: allMembers,
          };
          const created = await dataService.createGroup(payload);
          if (created) {
            const realId = String(created.id);
            // Swap temp → real ID in scenario data and GroupService cache.
            state.confirmGroupCreate(op.group.id, realId);
            // Remove this group from scenarioGroups (now baseline).
            if (activeScen?.scenarioGroups) {
              activeScen.scenarioGroups = activeScen.scenarioGroups.filter(
                (g) => String(g.id) !== realId && String(g.id) !== String(op.group.id)
              );
            }
            // Any members that were in the scenario group but NOT committed stay
            // pending as memberDeltas against the now-real group.
            const uncommittedMembers = allOriginalMembers.filter(
              (tid) => !committedMembers.has(tid)
            );
            if (uncommittedMembers.length > 0) {
              if (!activeScen.groupOverrides) activeScen.groupOverrides = {};
              const ov = activeScen.groupOverrides[realId] || {};
              const existingDeltas = ov.memberDeltas || [];
              const existingSet = new Set(existingDeltas.map((d) => d.taskId));
              for (const tid of uncommittedMembers) {
                if (!existingSet.has(tid))
                  existingDeltas.push({ taskId: tid, op: 'add' });
              }
              activeScen.groupOverrides[realId] = { ...ov, memberDeltas: existingDeltas };
            }
            if (op.group.plan_id) affectedPlanIds.add(String(op.group.plan_id));
          }
        } else if (op.type === 'update' && op.groupId) {
          const activeScen = state.getActiveScenario();
          const updatePayload = { ...(op.fields || {}) };

          // Apply any committed member deltas to compute the new full members list.
          if (op.memberDeltas?.length) {
            const baseGroup = groupService.getGroupById(op.groupId);
            const baseMembers = new Set((baseGroup?.members || []).map(String));
            for (const { taskId, op: delta } of op.memberDeltas) {
              if (delta === 'add') baseMembers.add(String(taskId));
              else baseMembers.delete(String(taskId));
            }
            updatePayload.members = [...baseMembers];
          }

          await dataService.updateGroup(op.groupId, updatePayload);

          // Remove only the committed deltas from groupOverrides; leave others.
          if (activeScen?.groupOverrides?.[op.groupId]) {
            const ov = activeScen.groupOverrides[op.groupId];
            if (op.memberDeltas?.length) {
              const committed = new Set(op.memberDeltas.map((d) => String(d.taskId)));
              ov.memberDeltas = (ov.memberDeltas || []).filter(
                (d) => !committed.has(String(d.taskId))
              );
            }
            // Remove the entire override entry if nothing remains.
            const { _deleted, memberDeltas: rem, ...rest } = ov;
            if (!_deleted && (!rem || rem.length === 0) && Object.keys(rest).length === 0) {
              delete activeScen.groupOverrides[op.groupId];
            }
          }

          const g = groupService.getGroupById(op.groupId);
          if (g?.plan_id) affectedPlanIds.add(String(g.plan_id));
        } else if (op.type === 'delete' && op.groupId) {
          await dataService.deleteGroup(op.groupId);
          const activeScen = state.getActiveScenario();
          if (activeScen?.groupOverrides?.[op.groupId]) {
            delete activeScen.groupOverrides[op.groupId];
          }
          const g = groupService.getGroupById(op.groupId);
          if (g?.plan_id) affectedPlanIds.add(String(g.plan_id));
        }
      }

      if (groupChanges.length > 0) {
        console.log('[ScenarioMenu] Persisted group changes', groupChanges);

        // Evict and reload GroupService cache for affected plans so the board
        // sees the authoritative server state (real UUIDs, up-to-date members/names).
        for (const planId of affectedPlanIds) {
          groupService.evictPlan(planId);
          groupService.loadGroups(planId).catch((err) =>
            console.warn('[ScenarioMenu] group reload failed for plan', planId, err)
          );
        }
      }

      // 2. Persist accepted feature overrides.
      if (features.length > 0) {
        await dataService.publishBaseline(features);
        console.log('[ScenarioMenu] Saved feature changes', features);
      }

      // 3. Save the scenario to disk whenever anything was committed so the
      //    stored overrides and pendingGroupChanges reflect the new state.
      //    This prevents stale temp IDs, already-deleted groups, and already-
      //    committed overrides from reappearing after a page reload.
      if (features.length > 0 || groupChanges.length > 0) {
        await state.saveScenario(scenario.id);
      }

      // 4. Refresh baseline so the board reflects the now-persisted state.
      if (features.length > 0 || groupChanges.length > 0) {
        try {
          await state.refreshBaseline();
          console.log('[ScenarioMenu] Baseline refreshed after save');
        } catch (refreshErr) {
          console.warn('[ScenarioMenu] Baseline refresh failed:', refreshErr);
        }
      }
    } catch (err) {
      console.error('[ScenarioMenu] Failed to save:', err);
    }
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
          ${sorted.map(
            (s) => html`
              <li
                class="sidebar-list-item scenario-item ${s.id === this.activeScenarioId ?
                  'active'
                : ''}"
                @click=${(e) => this._onScenarioClick(e, s)}
              >
                <span class="scenario-name" title="${s.name}">${s.name}</span>
                ${state.isScenarioUnsaved?.(s) ?
                  html` <span class="scenario-warning" title="Unsaved changes">⚠️</span> `
                : ''}
                ${s.readonly ?
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
                : html`
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
                          state.getPendingGroupChanges?.().length > 0
                        ) ?
                        html`
                          <button
                            type="button"
                            class="action-btn"
                            title="Save to Azure DevOps"
                            @click=${(e) => this._onSaveToAzure(e, s)}
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
            `
          )}
        </ul>
        <button type="button" class="copy-scenario-btn" @click=${this._onCopyScenario}>
          📋 Copy Scenario
        </button>
      </div>
    `;
  }
}

customElements.define('scenario-menu', ScenarioMenuLit);
