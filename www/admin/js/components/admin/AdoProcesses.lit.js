import { html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from './BaseConfigComponent.lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdoProcesses extends BaseConfigComponent {
  static properties = {
    plans: { type: Array },
    busy: { type: Boolean },
    dirty: { type: Boolean },
  };

  static styles = [BaseConfigComponent.styles, css`
    .heading, summary, .process-meta { display: flex; align-items: center; gap: 12px; }
    .heading { justify-content: space-between; margin-bottom: 12px; }
    .heading h2 { margin: 0; }
    .panel .editor { display: block; padding: 0; }
    details { border: 1px solid #d6dce2; border-radius: 6px; margin-bottom: 12px; }
    summary { cursor: pointer; padding: 12px; flex-wrap: wrap; }
    summary::before { content: '+'; font-weight: bold; width: 12px; }
    details[open] summary::before { content: '-'; }
    .process-name { font-weight: 600; }
    .muted { color: #59636f; font-size: 0.85rem; }
    .process-meta { padding: 0 12px 12px; flex-wrap: wrap; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem; }
    th, td { border-top: 1px solid #e5e7eb; padding: 10px 12px; vertical-align: top; }
    th { background: #f5f7f9; color: #485463; font-weight: 600; }
    .states { display: flex; flex-wrap: wrap; gap: 4px; }
    .state { padding: 2px 7px; border-radius: 4px; background: #e7ebef; color: #283643; }
    .state[data-category='InProgress'] { background: #dbeafe; color: #1e40af; }
    .state[data-category='Resolved'] { background: #fff0c2; color: #704d00; }
    .state[data-category='Completed'] { background: #dcfce7; color: #166534; }
    .state[data-category='Removed'] { background: #fee2e2; color: #991b1b; }
    .missing { display: block; color: #a13a18; font-size: 0.8rem; margin-top: 4px; }
    .actions { flex-shrink: 0; }
    button:disabled { opacity: 0.55; cursor: default; }
    input[type='checkbox'] { width: 16px; height: 16px; }
  `];

  constructor() {
    super();
    this.content = { schema_version: 1, processes: [] };
    this.plans = [];
    this.busy = false;
    this.dirty = false;
    this._ready = false;
  }

  _reportError(error, context) {
    console.error(context, error);
    this.statusMsg = error.message;
    this.statusType = 'error';
  }

  async loadConfig() {
    this.loading = true;
    try {
      const [catalogue, projects] = await Promise.all([
        adminProvider.getAdoProcesses(), adminProvider.getProjects(),
      ]);
      if (!catalogue.ok) throw new Error(catalogue.error.message);
      if (!projects.ok) throw new Error(projects.error.message);
      this.content = catalogue.data;
      this.plans = projects.data.project_map;
      this._ready = true;
      this.dirty = false;
      this.statusMsg = '';
    } catch (error) {
      this._reportError(error, 'Loading Azure DevOps process catalogue failed');
    } finally {
      this.loading = false;
    }
  }

  _plansForProcess(process) {
    const projects = new Set(process.projects.map((name) => name.toLowerCase()));
    return this.plans.filter((plan) => projects.has(
      plan.area_path.replaceAll('/', '\\').replace(/^\\+/, '').split('\\')[0].toLowerCase(),
    ));
  }

  _plansForType(process, item) {
    return this._plansForProcess(process).filter((plan) => plan.task_types.some(
      (name) => name.toLowerCase() === item.name.toLowerCase(),
    ));
  }

  _onImport(processId, reference, imported) {
    this.content = { ...this.content, processes: this.content.processes.map((process) => (
      process.id === processId ? { ...process, types: process.types.map((item) => (
        item.reference_name === reference ? { ...item, imported } : item
      )) } : process
    )) };
    this.dirty = true;
    this.statusMsg = '';
  }

  async saveConfig() {
    if (this.busy || !this.dirty) return;
    this.busy = true;
    this.statusMsg = 'Saving import selections...';
    this.statusType = '';
    try {
      const result = await adminProvider.saveAdoProcesses(this.content);
      if (!result.ok) throw new Error(result.error.message);
      this.content = result.data.content;
      this.dirty = false;
      this.statusMsg = 'Import selections saved';
      this.statusType = 'success';
    } catch (error) {
      this._reportError(error, 'Saving Azure DevOps process imports failed');
    } finally {
      this.busy = false;
    }
  }

  async _onReload() {
    if (this.busy) return;
    if (this.dirty && !window.confirm('Discard unsaved import selections and reload from Azure DevOps?')) return;
    this.busy = true;
    this.statusMsg = 'Loading process definitions from Azure DevOps...';
    this.statusType = '';
    try {
      const [result, projects] = await Promise.all([
        adminProvider.refreshAdoProcesses(), adminProvider.getProjects(),
      ]);
      if (!result.ok) throw new Error(result.error.message);
      if (!projects.ok) throw new Error(projects.error.message);
      this.content = result.data.content;
      this.plans = projects.data.project_map;
      this._ready = true;
      this.dirty = false;
      this.statusMsg = 'Process definitions reloaded';
      this.statusType = 'success';
    } catch (error) {
      this._reportError(error, 'Refreshing Azure DevOps process catalogue failed');
    } finally {
      this.busy = false;
    }
  }

  _renderType(process, item) {
    const plans = this._plansForType(process, item);
    const used = plans.length > 0;
    let reason = '';
    if (used) reason = `Used by: ${plans.map((plan) => plan.name).join(', ')}`;
    else if (item.backlog_level === 'task') reason = 'Task-level types cannot be imported';
    else if (item.missing) reason = 'Missing types can only be un-imported';
    return html`<tr>
      <td><input type="checkbox" data-type=${item.reference_name}
        aria-label=${`Import ${item.name} from ${process.name}`} title=${reason}
        .checked=${item.imported}
        ?disabled=${this.busy || used || item.backlog_level === 'task' || (item.missing && !item.imported)}
        @change=${(event) => this._onImport(process.id, item.reference_name, event.target.checked)}></td>
      <td>${item.name}${item.missing ? html`<span class="missing">Missing in Azure DevOps</span>` : ''}</td>
      <td>${item.backlog_level}</td>
      <td><div class="states">${item.states.map((state) => html`
        <span class="state" data-category=${state.category} title=${state.category}>${state.name}</span>
      `)}</div></td>
      <td title=${plans.map((plan) => plan.name).join(', ')}>${plans.length}
        ${used ? html`<div class="muted">${plans.map((plan) => plan.name).join(', ')}</div>` : ''}</td>
    </tr>`;
  }

  render() {
    return html`<section class="panel" aria-label="Azure DevOps Processes">
      <div class="heading"><h2>Azure DevOps Processes</h2>
        <button data-action="reload"
          ?disabled=${this.busy || this.loading || (this._ready && this.content.processes.length === 0)}
          @click=${this._onReload}>Reload from Azure DevOps</button></div>
      <div class="editor" aria-busy=${this.loading || this.busy}>
        ${this.loading ? html`<div class="loading">Loading process catalogue...</div>` :
          this.content.processes.map((process) => html`
          <details open>
            <summary><span class="process-name">${process.name}</span>
              ${process.parent_name ? html`<span class="muted">Inherits from ${process.parent_name}</span>` : ''}
              <span class="muted">${process.types.filter((item) => item.imported).length} of
                ${process.types.length} types imported</span></summary>
            <div class="process-meta muted"><span>Projects: ${process.projects.join(', ')}</span>
              <span>Loaded: <time datetime=${process.loaded_at}>${new Date(process.loaded_at).toLocaleString()}</time></span>
              <span>Plans affected: ${this._plansForProcess(process).length}</span></div>
            <table><thead><tr><th>Import</th><th>Work item type</th><th>Backlog level</th>
              <th>States</th><th>Plans</th></tr></thead><tbody>
              ${process.types.map((item) => this._renderType(process, item))}
            </tbody></table>
          </details>
        `)}
        ${!this.loading && this.content.processes.length === 0 ? html`<p>No process definitions loaded.
          <a href=${new URL('#projects', window.location.href).href}>Add a plan</a></p>` : ''}
      </div>
      <div class="actions"><button class="primary" data-action="save"
        ?disabled=${!this._ready || !this.dirty || this.busy || this.loading}
        @click=${this.saveConfig}>Save import selections</button>
        <span class=${`status ${this.statusType}`} role="status">${this.statusMsg}</span></div>
    </section>`;
  }
}

customElements.define('admin-ado-processes', AdoProcesses);