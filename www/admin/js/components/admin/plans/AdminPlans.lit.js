import { html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from '../BaseConfigComponent.lit.js';
import { adminProvider } from '../../../services/providerREST.js';
import './PlansList.lit.js';
import './PlanDrawer.lit.js';
import './PlanLevels.lit.js';
import './DefaultWorkforce.lit.js';

export class AdminPlans extends BaseConfigComponent {
  static properties = { ...BaseConfigComponent.properties, permissions: { type: Array },
    view: { state: true }, workforce: { state: true }, iterations: { state: true }, catalogue: { state: true },
    saving: { state: true }, statuses: { state: true }, drawerOpen: { state: true }, editingPlan: { state: true },
    drawerError: { state: true }, drawerSaved: { state: true }, drawerBusy: { state: true },
    drawerFeedback: { state: true }, drawerLoadFailed: { state: true }, rawText: { state: true } };
  static styles = [BaseConfigComponent.styles, css`
    :host { height: auto; }
    nav { display: flex; gap: 4px; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px; }
    nav button { border: 0; border-radius: 0; background: none; border-bottom: 3px solid transparent; }
    nav button[aria-selected=true] { color: #1d4ed8; border-color: #3b82f6; }
    .tools { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .tools h2 { margin: 0; }
    fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    textarea { box-sizing: border-box; width: 100%; height: 55vh; padding: 12px; font-family: monospace; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .status { display: block; margin: 12px 0; }
  `];
  constructor() {
    super();
    this.content = { schema_version: 4, container_types: [], project_map: [], allocation_defaults: {} };
    this.permissions = [];
    this.view = 'Plans';
    this.workforce = { teams: [], groups: [] };
    this.iterations = [];
    this.catalogue = { schema_version: 1, processes: [] };
    this.saving = false;
    this.statuses = {};
    this.drawerOpen = false;
    this.editingPlan = null;
    this.drawerError = '';
    this.drawerSaved = false;
    this.drawerBusy = false;
    this.drawerFeedback = '';
    this.drawerLoadFailed = false;
    this.rawText = '';
    this._saveQueue = Promise.resolve();
    this._queued = 0;
    this._refreshing = new Set();
  }
  get configType() { return 'projects'; }
  get title() { return 'Plans'; }
  async loadConfig() {
    this.loading = true;
    this.statusMsg = '';
    try {
      const results = await Promise.all([adminProvider.getProjects(), adminProvider.getWorkforce(),
        adminProvider.getIterations(), adminProvider.getAdoProcesses()]);
      for (const result of results) if (!result.ok) throw new Error(result.error.message);
      this.content = results[0].data;
      this.workforce = results[1].data.content.teams;
      this.iterations = results[2].data.iteration_sets;
      this.catalogue = results[3].data;
      this.rawText = JSON.stringify(this.content, null, 2);
    } catch (error) {
      console.error('Loading plans administration failed', error);
      this.statusMsg = `Could not load plans: ${error.message}`;
      this.statusType = 'error';
    } finally {
      this.loading = false;
    }
  }
  openDrawer(plan) {
    this.editingPlan = plan;
    this.drawerError = '';
    this.drawerSaved = false;
    this.drawerFeedback = '';
    this.drawerLoadFailed = false;
    this.drawerOpen = true;
  }
  closeDrawer() { if (!this.drawerBusy) this.drawerOpen = false; }
  async saveContent(content, processImports = {}) {
    const snapshot = structuredClone(content);
    this._queued += 1;
    this.saving = true;
    const operation = this._saveQueue.then(async () => {
      this.statusMsg = 'Saving...';
      this.statusType = '';
      try {
        const result = await adminProvider.saveProjects(snapshot, processImports);
        if (!result.ok) throw new Error(result.error.message);
        this.content = snapshot;
        this.rawText = JSON.stringify(snapshot, null, 2);
        this.statusMsg = 'Saved successfully';
        this.statusType = 'success';
        return true;
      } catch (error) {
        console.error('Saving plans failed', error);
        this.statusMsg = error.message;
        this.statusType = 'error';
        return false;
      } finally {
        this._queued -= 1;
        this.saving = this._queued > 0;
      }
    });
    this._saveQueue = operation;
    return operation;
  }
  async submitPlan(event) {
    if (this.drawerBusy) return;
    const { plan, processImports, refresh } = event.detail;
    const exists = this.content.project_map.some((entry) => entry.id === plan.id);
    const content = { ...this.content, project_map: exists
      ? this.content.project_map.map((entry) => entry.id === plan.id ? plan : entry)
      : [...this.content.project_map, plan] };
    this.drawerBusy = true;
    this.drawerError = '';
    const saved = await this.saveContent(content, processImports);
    if (!saved) {
      this.drawerError = this.statusMsg;
      this.drawerBusy = false;
      return;
    }
    this.drawerSaved = true;
    this.drawerFeedback = 'Plan saved';
    if (refresh && !plan.archived) await this.refreshPlan(plan.id);
    this.drawerBusy = false;
    await this._reloadCatalogue();
  }
  async _reloadCatalogue() {
    try {
      const result = await adminProvider.getAdoProcesses();
      if (!result.ok) throw new Error(result.error.message);
      this.catalogue = result.data;
    } catch (error) {
      console.error('Reloading saved plan imports failed', error);
      this.statusMsg = `Plan saved; could not reload imports: ${error.message}`;
      this.statusType = 'error';
    }
  }
  async refreshPlan(planId) {
    if (this._refreshing.has(planId)) return;
    this._refreshing.add(planId);
    this.statuses = { ...this.statuses, [planId]: { error: false, message: 'Loading work items...' } };
    const inDrawer = this.drawerOpen && this.shadowRoot.querySelector('plan-drawer') !== null;
    if (inDrawer) { this.drawerBusy = true; this.drawerFeedback = 'Loading work items...'; this.drawerLoadFailed = false; }
    try {
      const result = await adminProvider.refreshPlan(planId);
      if (!result.ok) throw new Error(result.error.message);
      const message = `Loaded ${result.data.item_count} work items`;
      this.statuses = { ...this.statuses, [planId]: { error: false, message } };
      if (inDrawer) this.drawerFeedback = message;
    } catch (error) {
      console.error('Loading plan work items failed', { planId, error });
      const message = `Data not loaded: ${error.message}`;
      this.statuses = { ...this.statuses, [planId]: { error: true, message } };
      if (inDrawer) { this.drawerFeedback = message; this.drawerLoadFailed = true; }
    } finally {
      this._refreshing.delete(planId);
      if (inDrawer) this.drawerBusy = false;
    }
  }
  async planAction(event) {
    const { id, action } = event.detail;
    const plan = this.content.project_map.find((entry) => entry.id === id);
    if (action === 'delete' && !window.confirm(`Delete plan "${plan.name}"? This cannot be undone.`)) return;
    const projectMap = action === 'delete' ? this.content.project_map.filter((entry) => entry.id !== id)
      : this.content.project_map.map((entry) => entry.id === id ? { ...entry, archived: action === 'archive' } : entry);
    const saved = await this.saveContent({ ...this.content, project_map: projectMap });
    if (!saved) { this.drawerError = this.statusMsg; return; }
    this.closeDrawer();
    if (action === 'restore') await this.refreshPlan(id);
  }
  async saveRaw() {
    if (!this.permissions.includes('admin')) return;
    let content;
    try { content = JSON.parse(this.rawText); }
    catch (error) { this.statusMsg = `Invalid JSON: ${error.message}`; this.statusType = 'error'; return; }
    await this.saveContent(content);
  }
  render() {
    if (this.loading) return html`<p role="status">Loading plans...</p>`;
    const raw = this.permissions.includes('admin') && this.useRawMode;
    return html`<div class="tools"><h2>Plans</h2><div>
      <button ?disabled=${this.saving || this.drawerOpen} @click=${this.loadConfig}>Reload</button>
      ${this.permissions.includes('admin') ? html`<button ?disabled=${this.saving || this.drawerOpen}
        @click=${() => { this.useRawMode = !this.useRawMode; this.rawText = JSON.stringify(this.content, null, 2); }}>${raw ? 'Form mode' : 'Raw JSON'}</button>` : ''}</div></div>
      <fieldset ?disabled=${this.saving || this.drawerOpen} ?inert=${this.saving || this.drawerOpen}>
        ${raw ? html`<textarea aria-label="Plans JSON" .value=${this.rawText}
          @input=${(event) => { this.rawText = event.target.value; }}></textarea>
          <button class="primary" @click=${this.saveRaw}>Save</button>` : html`
          <nav role="tablist" aria-label="Plans administration">${['Plans', 'Plan levels', 'Default workforce'].map((view) =>
            html`<button role="tab" aria-selected=${this.view === view} @click=${() => { this.view = view; }}>${view}</button>`)}</nav>
          <div @config-change=${(event) => this.saveContent(event.detail)}>
            ${this.view === 'Plans' ? html`<plans-list .content=${this.content} .catalogue=${this.catalogue}
              .statuses=${this.statuses} .busy=${this.saving} @new-plan=${() => this.openDrawer(null)}
              @edit-plan=${(event) => this.openDrawer(this.content.project_map.find((plan) => plan.id === event.detail))}
              @plan-action=${this.planAction} @refresh-plan=${(event) => this.refreshPlan(event.detail)}></plans-list>`
              : this.view === 'Plan levels' ? html`<plan-levels .content=${this.content}></plan-levels>`
                : html`<plan-default-workforce .content=${this.content} .catalogue=${this.workforce}></plan-default-workforce>`}
          </div>`}</fieldset><div role="status" class="status ${this.statusType}">${this.statusMsg}</div>
      ${this.drawerOpen ? html`<plan-drawer .plan=${this.editingPlan} .content=${this.content}
        .catalogue=${this.catalogue} .workforce=${this.workforce} .iterations=${this.iterations}
        .busy=${this.drawerBusy} .error=${this.drawerError} .saved=${this.drawerSaved}
        .feedback=${this.drawerFeedback} .loadFailed=${this.drawerLoadFailed}
        @plan-submit=${this.submitPlan} @close-drawer=${this.closeDrawer} @plan-action=${this.planAction}
        @refresh-plan=${(event) => this.refreshPlan(event.detail)}></plan-drawer>` : ''}`;
  }
}
customElements.define('admin-projects', AdminPlans);