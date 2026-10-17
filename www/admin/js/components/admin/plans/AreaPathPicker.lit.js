import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from '../BaseConfigComponent.lit.js';
import { adminProvider } from '../../../services/providerREST.js';

export class AreaPathPicker extends LitElement {
  static properties = { areaPath: { type: String }, currentId: { type: String }, plans: { type: Array },
    projects: { state: true }, paths: { state: true }, project: { state: true }, process: { state: true },
    pending: { state: true }, error: { state: true }, filter: { state: true }, loadingProjects: { state: true } };
  static styles = [BaseConfigComponent.styles, css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    label { display: block; font-weight: 600; margin-bottom: 8px; }
    select, input { padding: 8px; width: 100%; box-sizing: border-box; margin-bottom: 12px; }
    .paths { flex: 1; min-height: 0; overflow: auto; border-top: 1px solid #e5e7eb; }
    .path { display: block; width: 100%; text-align: left; border: 0; border-radius: 0;
      background: white; border-bottom: 1px solid #e5e7eb; overflow-wrap: anywhere; }
    .path[aria-pressed=true] { background: #dbeafe; }
    button:disabled { color: #6b7280; cursor: not-allowed; }
    .error { color: #b91c1c; }
    small { display: block; font-weight: normal; }
  `];
  constructor() {
    super();
    this.areaPath = '';
    this.currentId = '';
    this.plans = [];
    this.projects = [];
    this.paths = [];
    this.project = '';
    this.process = null;
    this.pending = false;
    this.error = '';
    this.filter = '';
    this.loadingProjects = false;
    this._request = 0;
  }
  connectedCallback() {
    super.connectedCallback();
    this.loadProjects();
  }
  disconnectedCallback() {
    this._request += 1;
    super.disconnectedCallback();
  }
  _notify() {
    this.dispatchEvent(new CustomEvent('area-change', { bubbles: true, composed: true,
      detail: { areaPath: this.areaPath, process: this.process, pending: this.pending, error: this.error } }));
  }
  async loadProjects() {
    this.loadingProjects = true;
    this.error = '';
    try {
      const config = await adminProvider.getBrowseConfig();
      if (!config.ok) throw new Error(config.error.message);
      const result = await adminProvider.browseAzureProjects(config.data.organization_url);
      if (!result.ok) throw new Error(result.error.message);
      if (!this.isConnected) return;
      this.projects = result.data.projects;
      if (this.areaPath) await this.selectProject(this.areaPath.split(/[\\/]/)[0], true);
    } catch (error) {
      console.error('Loading ADO projects failed', error);
      this.error = error.message;
      this._notify();
    } finally {
      this.loadingProjects = false;
    }
  }
  async selectProject(project, preserveArea = false) {
    const request = ++this._request;
    this.project = project;
    if (!preserveArea) this.areaPath = '';
    this.paths = [];
    this.process = null;
    this.error = '';
    this.filter = '';
    this.pending = project !== '';
    this._notify();
    if (!project) return;
    try {
      const [paths, resolved] = await Promise.all([
        adminProvider.browseAreaPaths(project), adminProvider.resolveAdoProcess(project),
      ]);
      if (request !== this._request || !this.isConnected) return;
      if (!paths.ok) throw new Error(paths.error.message);
      if (!resolved.ok) throw new Error(resolved.error.message);
      this.paths = paths.data.area_paths;
      this.process = resolved.data.content;
    } catch (error) {
      if (request !== this._request || !this.isConnected) return;
      console.error('Resolving ADO project failed', { project, error });
      this.error = error.message;
    } finally {
      if (request === this._request && this.isConnected) {
        this.pending = false;
        this._notify();
      }
    }
  }
  render() {
    return html`<label for="project">Azure DevOps project</label><select id="project"
      ?disabled=${this.loadingProjects} @change=${(event) => this.selectProject(event.target.value)}>
      <option value="" .selected=${!this.project}>Select a project</option>
      ${this.projects.map((project) => html`<option .value=${project}
        .selected=${project === this.project}>${project}</option>`)}
      </select>${this.loadingProjects ? html`<p role="status">Loading projects...</p>` : ''}
      ${this.pending ? html`<p role="status">Loading area paths and process...</p>` : ''}
      ${this.error ? html`<div class="error" role="alert">${this.error}
        <button data-retry @click=${() => this.project
          ? this.selectProject(this.project, true) : this.loadProjects()}>Retry</button></div>` : ''}
      ${this.process === null ? '' : html`<p>Process: <strong>${this.process.name}</strong></p>`}
      ${this.paths.length > 0 ? html`<input type="search" aria-label="Filter area paths" placeholder="Filter area paths"
        .value=${this.filter} @input=${(event) => { this.filter = event.target.value; }}>
        <div class="paths">${this.paths.filter((path) => path.toLowerCase().includes(this.filter.toLowerCase())).map((path) => {
          const used = this.plans.find((plan) => plan.id !== this.currentId
            && plan.area_path.toLowerCase() === path.toLowerCase());
          return html`<button class="path" data-path=${path} ?disabled=${used !== undefined || this.pending}
            aria-pressed=${path === this.areaPath} style=${`padding-left: ${10 + (path.split(/[\\/]/).length - 1) * 18}px`}
            @click=${() => { this.areaPath = path; this._notify(); }}>${path.split(/[\\/]/).at(-1)}
            ${used === undefined ? '' : html`<small>used by ${used.name}</small>`}</button>`;
        })}</div>` : ''}`;
  }
}
customElements.define('plan-area-path-picker', AreaPathPicker);