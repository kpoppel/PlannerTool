import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { ProjectEvents, TeamEvents, ScenarioEvents, DataEvents, ViewManagementEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import './PlanMenu.lit.js';
import './TeamMenu.lit.js';
import './ScenarioMenu.lit.js';
import './ViewMenu.lit.js';

export class TopMenuBarLit extends LitElement {
  static properties = {
    openMenu: { type: String }, // 'view', 'scenario', 'plan', 'team', or null
    projects: { type: Array },
    teams: { type: Array },
    scenarios: { type: Array },
    activeScenarioId: { type: String },
    views: { type: Array },
    activeViewId: { type: String },
    activeViewData: { type: Object },
    selectedProjectsCount: { type: Number },
    selectedTeamsCount: { type: Number },
  };

  static styles = css`
    :host { display: block; }
    .menu-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      width: 100%;
      background: var(--color-sidebar-bg);
      color: white;
      display: flex;
      align-items: center;
      overflow: visible;
      gap: 10px;
      z-index: 1000;
      box-shadow: 0 2px 4px rgba(0,0,0,0.08);
      font-size: 13px;
      user-select: none;
    }

    .menu-left { display:flex; gap:12px; align-items:center; padding-left:12px; }
    .title-only { margin-left:6px; font-weight:700; }
    /* menu items positioned above timeline left edge (right edge of sidebar) */
    .menu-items { position: absolute; left: calc(var(--sidebar-width) + 28px); top: 4px; display:flex; gap:12px; align-items:center; white-space:nowrap; z-index: 1100; }
    .menu-right { position: absolute; right: 8px; top: 4px; display:flex; gap:12px; align-items:center; white-space:nowrap; z-index: 1100; }

    .menu-item {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px;
      padding: 6px 10px;
      color: white;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: background 160ms ease, transform 120ms ease;
      flex-shrink: 0;
    }

    .menu-item:hover { background: rgba(255,255,255,0.12); }
    .menu-item.active { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.22); }

    .icon { font-size: 14px; }

    .small-btn {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.14);
      padding: 6px 12px;
      border-radius: 6px;
      color: white;
      cursor: pointer;
      font-weight: 600;
      display: inline-flex;
      white-space: nowrap;
    }

    /* ensure buttons remain fully visible at the edge */
    .small-btn { box-shadow: 0 1px 0 rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.02); }

    /* extra safe spacing to avoid accidental overlap with other UI */
    .small-btn + .small-btn { margin-left: 4px; }

    .small-btn:hover { background: rgba(255,255,255,0.16); }

    /* Ensure main content is pushed under the menu bar visually */
    :host([offset]) ~ .main, :host ~ .main { padding-top: 40px; }

    .app-title { font-weight:700; font-size:14px; margin-right:6px; }

    /* Menu popover positioning */
    .menu-popover-container {
      position: fixed;
      z-index: 2000;
    }

    .menu-count-badge {
      background: rgba(255,255,255,0.12);
      color: white;
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 11px;
      margin-left: 6px;
      min-width: 20px;
      text-align: center;
      line-height: 1;
    }
  `;

  constructor() {
    super();
    this.openMenu = null;
    this.projects = [];
    this.teams = [];
    this.scenarios = [];
    this.activeScenarioId = null;
    this.views = [];
    this.activeViewId = null;
    this.activeViewData = null;
    this.selectedProjectsCount = 0;
    this.selectedTeamsCount = 0;
    this._ensureGlobalMenuStyles();
  }

  _ensureGlobalMenuStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('topmenu-popover-styles')) return;
    const s = document.createElement('style');
    s.id = 'topmenu-popover-styles';
    s.textContent = `
.scenario-menu-popover, .view-menu-popover {
  position: absolute;
  background: #fff;
  color: #222;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.18);
  min-width: 160px;
  z-index: 3000;
  font-family: var(--font-family, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial);
  font-size: 14px;
}
.scenario-menu-popover .scenario-menu-item,
.view-menu-popover .scenario-menu-item {
  margin: 4px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
  color: #222;
  border-radius: 4px;
}
.scenario-menu-popover .scenario-menu-item span:first-child,
.view-menu-popover .scenario-menu-item span:first-child {
  display: inline-flex;
  width: 22px;
  justify-content: center;
  align-items: center;
  font-size: 16px;
}
.scenario-menu-popover .scenario-menu-item span:last-child,
.view-menu-popover .scenario-menu-item span:last-child {
  flex: 1;
}
.scenario-menu-popover .scenario-menu-item:hover,
.view-menu-popover .scenario-menu-item:hover { background: #f3f5f7; }
.scenario-menu-popover .scenario-menu-item.disabled,
.view-menu-popover .scenario-menu-item.disabled { color: #999; cursor: default; }
`;
    document.head.appendChild(s);
  }

  async connectedCallback() {
    super.connectedCallback();
    // Close menu when clicking outside
    this._outsideClickHandler = (e) => {
      if (this.openMenu && !e.composedPath().includes(this)) {
        this.openMenu = null;
      }
    };
    document.addEventListener('click', this._outsideClickHandler);

    // Handle scenario menu actions
    this._scenarioMenuHandler = async (e) => {
      const { scenario, sourceEvent } = e.detail;
      // Import and show scenario action menu (clone, rename, delete, etc.)
      await this._showScenarioActionsMenu(scenario, sourceEvent);
    };
    this.addEventListener('scenario-menu', this._scenarioMenuHandler);

    // Handle view menu actions
    this._viewMenuHandler = async (e) => {
      const { view, sourceEvent } = e.detail;
      // Import and show view action menu (rename, delete, update, etc.)
      await this._showViewActionsMenu(view, sourceEvent);
    };
    this.addEventListener('view-menu', this._viewMenuHandler);

    // Listen to state changes to update menu data
    this._onProjectsChanged = (projects) => {
      const arr = projects ? [...projects] : [];
      this.projects = arr;
      this.selectedProjectsCount = arr.filter(p => p && p.selected).length;
    };
    this._onTeamsChanged = (teams) => {
      const arr = teams ? [...teams] : [];
      this.teams = arr;
      this.selectedTeamsCount = arr.filter(t => t && t.selected).length;
    };
    this._onScenariosList = (payload) => {
      this.scenarios = payload?.scenarios || [];
      this.activeScenarioId = payload?.activeId || null;
    };
    this._onScenarioActivated = (payload) => { this.activeScenarioId = payload?.id || null; };
    this._onScenariosUpdated = () => { this.scenarios = state.getScenarios?.() || []; };
    this._onViewsList = (payload) => {
      this.views = payload?.views || [];
      this.activeViewId = payload?.activeId || null;
    };
    this._onViewActivated = (payload) => {
      this.activeViewId = payload?.id || null;
      this.activeViewData = payload?.data || null;
    };

    bus.on(ProjectEvents.CHANGED, this._onProjectsChanged);
    bus.on(TeamEvents.CHANGED, this._onTeamsChanged);
    bus.on(ScenarioEvents.LIST, this._onScenariosList);
    bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    bus.on(ScenarioEvents.UPDATED, this._onScenariosUpdated);
    bus.on(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    bus.on(ViewManagementEvents.LIST, this._onViewsList);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);

    // Initialize reactive properties from current state in case events were
    // emitted before this element was connected. This ensures the component
    // has current data immediately instead of waiting for subsequent events.
    try {
      this._onProjectsChanged(state.projects);
      this._onTeamsChanged(state.teams);
      this._onScenariosList({ scenarios: state.scenarios, activeId: state.activeScenarioId });
      this._onViewsList({ views: state.savedViews, activeId: state.activeViewId });
      // Also get current view data
      const currentView = state.getActiveView?.();
      if (currentView) {
        this.activeViewData = currentView;
      }
    } catch (e) {
      console.warn('[TopMenu] Failed to initialize state', e);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._outsideClickHandler) {
      document.removeEventListener('click', this._outsideClickHandler);
    }
    if (this._scenarioMenuHandler) {
      this.removeEventListener('scenario-menu', this._scenarioMenuHandler);
    }
    if (this._viewMenuHandler) {
      this.removeEventListener('view-menu', this._viewMenuHandler);
    }

    // Clean up event listeners
    if (this._onProjectsChanged) bus.off(ProjectEvents.CHANGED, this._onProjectsChanged);
    if (this._onTeamsChanged) bus.off(TeamEvents.CHANGED, this._onTeamsChanged);
    if (this._onScenariosList) bus.off(ScenarioEvents.LIST, this._onScenariosList);
    if (this._onScenarioActivated) bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    if (this._onScenariosUpdated) {
      bus.off(ScenarioEvents.UPDATED, this._onScenariosUpdated);
      bus.off(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    }
    if (this._onViewsList) bus.off(ViewManagementEvents.LIST, this._onViewsList);
    if (this._onViewActivated) bus.off(ViewManagementEvents.ACTIVATED, this._onViewActivated);
  }

  _toggleMenu(menuName, e) {
    e.stopPropagation();
    this.openMenu = this.openMenu === menuName ? null : menuName;
    
    if (this.openMenu) {
      // Store button position for menu positioning
      this._menuButtonRect = e.currentTarget.getBoundingClientRect();
      this.requestUpdate();
    }
  }

  render() {
    return html`
      <nav class="menu-bar" role="navigation" aria-label="Top menu">
        <div class="menu-left">
          <div class="app-title title-only">Planner Tool</div>
        </div>

        <div class="menu-items" role="menubar" aria-label="Main menus">
          <div class="menu-item ${this.openMenu === 'view' ? 'active' : ''}" 
               id="viewMenuBtn"
               role="button" 
               tabindex="0"
               @click=${(e) => this._toggleMenu('view', e)}>View</div>
          <div class="menu-item ${this.openMenu === 'scenario' ? 'active' : ''}" 
               id="scenarioMenuBtn"
               role="button" 
               tabindex="0"
               @click=${(e) => this._toggleMenu('scenario', e)}>Scenario</div>
          <div class="menu-item ${this.openMenu === 'plan' ? 'active' : ''}" 
            id="planMenuBtn"
            role="button" 
            tabindex="0"
            @click=${(e) => this._toggleMenu('plan', e)}>
            Plan
            ${this.selectedProjectsCount ? html`<span class="menu-count-badge">${this.selectedProjectsCount}</span>` : ''}
          </div>
          <div class="menu-item ${this.openMenu === 'team' ? 'active' : ''}" 
            id="teamMenuBtn"
            role="button" 
            tabindex="0"
            @click=${(e) => this._toggleMenu('team', e)}>
            Team
            ${this.selectedTeamsCount ? html`<span class="menu-count-badge">${this.selectedTeamsCount}</span>` : ''}
          </div>
        </div>

        <div class="menu-right">
          <button class="small-btn" id="openConfigBtn" data-tour="gear" @click=${this._onConfig}>⚙️</button>
          <button class="small-btn" id="openHelpBtn" data-tour="help" @click=${this._onHelp}>❓</button>
        </div>
      </nav>

      ${this._renderOpenMenu()}
    `;
  }

  _renderOpenMenu() {
    if (!this.openMenu || !this._menuButtonRect) return null;

    const style = `
      position: fixed;
      top: ${this._menuButtonRect.bottom + 4}px;
      left: ${this._menuButtonRect.left}px;
      z-index: 2000;
    `;

    switch (this.openMenu) {
      case 'view':
        return html`<view-menu style="${style}" .views=${this.views} .activeViewId=${this.activeViewId}></view-menu>`;
      case 'scenario':
        return html`<scenario-menu style="${style}" .scenarios=${this.scenarios} .activeScenarioId=${this.activeScenarioId}></scenario-menu>`;
      case 'plan':
        return html`<plan-menu style="${style}" .projects=${this.projects} .activeViewId=${this.activeViewId} .activeViewData=${this.activeViewData}></plan-menu>`;
      case 'team':
        return html`<team-menu style="${style}" .teams=${this.teams} .activeViewId=${this.activeViewId} .activeViewData=${this.activeViewData}></team-menu>`;
      default:
        return null;
    }
  }

  async _onConfig() {
    const { openConfigModal } = await import('./modalHelpers.js');
    await openConfigModal();
  }

  async _onHelp() {
    const { openHelpModal } = await import('./modalHelpers.js');
    await openHelpModal();
  }

  async _showScenarioActionsMenu(scenario, sourceEvent) {
    document.querySelectorAll('.scenario-menu-popover').forEach(p => p.remove());
    
    const menuBtn = sourceEvent.currentTarget;
    const pop = document.createElement('div');
    pop.className = 'scenario-menu-popover';
    
    const addItem = (label, emoji, onClick, disabled = false) => {
      const item = document.createElement('div');
      item.className = 'scenario-menu-item';
      if (disabled) item.classList.add('disabled');
      item.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
      if (!disabled) item.addEventListener('click', ev => { ev.stopPropagation(); onClick(); pop.remove(); });
      pop.appendChild(item);
    };
    
    const defaultCloneName = (() => {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const scenarios = state.getScenarios?.() || [];
      const maxN = Math.max(0, ...scenarios
        .map(sc => /^\d{2}-\d{2} Scenario (\d+)$/i.exec(sc.name)?.[1])
        .filter(Boolean)
        .map(n => parseInt(n, 10)));
      return `${mm}-${dd} Scenario ${maxN + 1}`;
    })();
    
    addItem('Clone Scenario', '⎘', async () => {
      const { openScenarioCloneModal } = await import('./modalHelpers.js');
      await openScenarioCloneModal({ id: scenario.id, name: defaultCloneName });
    });
    
    if (scenario.readonly) {
      addItem('Refresh Baseline', '🔄', () => state.refreshBaseline());
    } else {
      addItem('Rename', '✏️', async () => {
        const { openScenarioRenameModal } = await import('./modalHelpers.js');
        await openScenarioRenameModal({ id: scenario.id, name: scenario.name });
      });
      addItem('Delete', '🗑️', async () => {
        const { openScenarioDeleteModal } = await import('./modalHelpers.js');
        await openScenarioDeleteModal({ id: scenario.id, name: scenario.name });
      });
      addItem('Save Scenario', '💾', () => state.saveScenario(scenario.id));
      addItem('Save to Azure DevOps', '💾', async () => {
        const overrideEntries = Object.entries(scenario.overrides || {});
        if (overrideEntries.length === 0) return;
        const { openAzureDevopsModal } = await import('./modalHelpers.js');
        const selected = await openAzureDevopsModal({ overrides: scenario.overrides, state });
        if (selected?.length) await dataService.publishBaseline(selected);
      }, (scenario.overrides && Object.keys(scenario.overrides).length === 0));
    }
    
    const rect = menuBtn.getBoundingClientRect();
    Object.assign(pop.style, {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      background: '#fff',
      color: '#222',
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '6px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
      minWidth: '160px',
      zIndex: '3000'
    });
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  }

  async _showViewActionsMenu(view, sourceEvent) {
    document.querySelectorAll('.view-menu-popover').forEach(p => p.remove());
    
    const menuBtn = sourceEvent.currentTarget;
    const pop = document.createElement('div');
    pop.className = 'view-menu-popover scenario-menu-popover';
    
    const addItem = (label, emoji, onClick, disabled = false) => {
      const item = document.createElement('div');
      item.className = 'scenario-menu-item';
      if (disabled) item.classList.add('disabled');
      item.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
      if (!disabled) item.addEventListener('click', ev => { ev.stopPropagation(); onClick(); pop.remove(); });
      pop.appendChild(item);
    };
    
    if (view.readonly && view.id === 'default') {
      addItem('Clone to New View', '⎘', async () => {
        const { openViewSaveModal } = await import('./modalHelpers.js');
        const defaultName = (() => {
          const now = new Date();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const views = state.getViews?.() || [];
          const maxN = Math.max(0, ...views
            .map(v => /^\d{2}-\d{2} View (\d+)$/i.exec(v.name)?.[1])
            .filter(Boolean)
            .map(n => parseInt(n, 10)));
          return `${mm}-${dd} View ${maxN + 1}`;
        })();
        await openViewSaveModal({ name: defaultName });
      });
    } else {
      addItem('Update View', '💾', async () => {
        await state.viewManagementService.updateView(view.id);
      });
      addItem('Rename', '✏️', async () => {
        const { openViewRenameModal } = await import('./modalHelpers.js');
        await openViewRenameModal({ id: view.id, name: view.name });
      });
      addItem('Delete', '🗑️', async () => {
        const { openViewDeleteModal } = await import('./modalHelpers.js');
        await openViewDeleteModal({ id: view.id, name: view.name });
      });
    }
    
    const rect = menuBtn.getBoundingClientRect();
    Object.assign(pop.style, {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      background: '#fff',
      color: '#222',
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '6px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
      minWidth: '160px',
      zIndex: '3000'
    });
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  }
}

customElements.define('top-menu-bar', TopMenuBarLit);
