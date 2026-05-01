import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

/**
 * DataSources — Admin panel showing all data domains and their backend choices.
 *
 * Most domains are locked to a single backend and shown for information only.
 * The "Plan Events" domain is selectable between:
 *   "local"    — PlannerTool diskcache (default, no extra configuration)
 *   "ado_wiki" — Azure DevOps Wiki page (requires project, wiki ID, page path)
 *
 * When an alternative backend is selected a restart-required banner is shown.
 * Save persists to POST /admin/v1/events-config.
 *
 * This component intentionally does NOT use SchemaForm — conditional
 * sub-form visibility is handled with Lit's native conditional rendering so
 * it remains independent of SchemaForm's limited x-showWhen support.
 */
export class DataSources extends LitElement {
  static styles = css`
    :host { display: block; }

    h2 { margin-top: 0; font-size: 1.1rem; }

    .panel {
      padding: 12px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* ------------------------------------------------------------------ */
    /* Domain table                                                         */
    /* ------------------------------------------------------------------ */
    .domain-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .domain-table th {
      text-align: left;
      padding: 8px 10px;
      background: #f3f4f6;
      border-bottom: 2px solid #e5e7eb;
      font-weight: 600;
      color: #374151;
    }
    .domain-table td {
      padding: 10px;
      border-bottom: 1px solid #f0f0f0;
      vertical-align: top;
    }
    .domain-table tr:last-child td { border-bottom: none; }

    .domain-name {
      font-weight: 600;
      color: #1f2937;
    }
    .domain-desc {
      font-size: 0.82rem;
      color: #6b7280;
      margin-top: 2px;
    }

    .locked-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .locked-note {
      font-size: 0.8rem;
      color: #9ca3af;
      margin-top: 4px;
    }

    /* ------------------------------------------------------------------ */
    /* Selectable backend row (events)                                     */
    /* ------------------------------------------------------------------ */
    .backend-select-wrap {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    select.backend-select {
      padding: 7px 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
      background: #fff;
      max-width: 320px;
      cursor: pointer;
    }
    select.backend-select:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    /* ------------------------------------------------------------------ */
    /* ADO wiki sub-form                                                   */
    /* ------------------------------------------------------------------ */
    .sub-form {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 14px 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      max-width: 680px;
    }
    .sub-form .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sub-form .field.full {
      grid-column: 1 / -1;
    }
    .sub-form label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #374151;
    }
    .sub-form .desc {
      font-size: 0.8rem;
      color: #6b7280;
    }
    .sub-form input[type='text'],
    .sub-form select {
      padding: 7px 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
      font-family: inherit;
      background: #fff;
    }
    .sub-form input[type='text']:focus,
    .sub-form select:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    .sub-form input.error,
    .sub-form select.error { border-color: #ef4444; }
    .page-combo {
      position: relative;
    }
    .page-combo input {
      width: 100%;
      box-sizing: border-box;
    }
    .page-suggestions {
      position: absolute;
      z-index: 100;
      top: 100%;
      left: 0;
      right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: #fff;
      border: 1px solid #d1d5db;
      border-top: none;
      border-radius: 0 0 6px 6px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    .page-suggestion-item {
      padding: 7px 10px;
      font-size: 0.88rem;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .page-suggestion-item:hover {
      background: #eff6ff;
      color: #1d4ed8;
    }

    /* ------------------------------------------------------------------ */
    /* Restart notice                                                      */
    /* ------------------------------------------------------------------ */
    .restart-notice {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 6px;
      font-size: 0.88rem;
      color: #92400e;
    }
    .restart-notice .icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }

    /* ------------------------------------------------------------------ */
    /* Actions                                                             */
    /* ------------------------------------------------------------------ */
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
    button {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #ccc;
      background: #f3f4f6;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    button:hover { background: #e5e7eb; }
    button.primary {
      background: #3b82f6;
      color: #fff;
      border-color: #3b82f6;
    }
    button.primary:hover { background: #2563eb; }
    .status { font-size: 0.9rem; margin-left: 8px; }
    .status.success { color: #10b981; }
    .status.error   { color: #ef4444; }

    .loading {
      display: flex; align-items: center; justify-content: center;
      padding: 40px; color: #6b7280;
    }
  `;

  static properties = {
    _loading:          { type: Boolean, state: true },
    _backend:          { type: String,  state: true },
    _wikiProject:      { type: String,  state: true },
    _wikiId:           { type: String,  state: true },
    _wikiPagePath:     { type: String,  state: true },
    // Browse state
    _projects:         { type: Array,   state: true },
    _projectsLoading:  { type: Boolean, state: true },
    _projectsError:    { type: String,  state: true },
    _wikis:            { type: Array,   state: true },
    _wikisLoading:     { type: Boolean, state: true },
    _wikisError:       { type: String,  state: true },
    _wikiPages:        { type: Array,   state: true },
    _wikiPagesLoading: { type: Boolean, state: true },
    _wikiPagesError:   { type: String,  state: true },
    _pageFilter:       { type: String,  state: true },
    _pageDropdownOpen: { type: Boolean, state: true },
    _validationErrors: { type: Object,  state: true },
    _statusMsg:        { type: String,  state: true },
    _statusType:       { type: String,  state: true },
  };

  constructor() {
    super();
    this._loading          = false;
    this._backend          = 'local';
    this._wikiProject      = '';
    this._wikiId           = '';
    this._wikiPagePath     = '/PlannerTool/Events';
    this._projects         = [];
    this._projectsLoading  = false;
    this._projectsError    = '';
    this._wikis            = [];
    this._wikisLoading     = false;
    this._wikisError       = '';
    this._wikiPages        = [];
    this._wikiPagesLoading = false;
    this._wikiPagesError   = '';
    this._pageFilter       = '';
    this._pageDropdownOpen = false;
    this._validationErrors = {};
    this._statusMsg        = '';
    this._statusType       = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    this._loading = true;
    try {
      const cfg = await adminProvider.getEventsConfig();
      if (cfg) {
        this._backend      = cfg.event_backend || 'local';
        const wiki         = cfg.ado_wiki || {};
        this._wikiProject  = wiki.project   || '';
        this._wikiId       = wiki.wiki_id   || '';
        this._wikiPagePath = wiki.page_path || '/PlannerTool/Events';
      }
      // Pre-populate browse lists if backend is already ado_wiki
      if (this._backend === 'ado_wiki') {
        this._fetchProjects();
        if (this._wikiProject) this._fetchWikis(this._wikiProject);
        if (this._wikiProject && this._wikiId) this._fetchWikiPages(this._wikiProject, this._wikiId);
      }
    } catch (e) {
      this._statusMsg  = 'Error loading events configuration';
      this._statusType = 'error';
    } finally {
      this._loading = false;
    }
  }

  async _fetchProjects() {
    this._projectsLoading = true;
    this._projectsError   = '';
    try {
      const res = await adminProvider.browseAzureProjects();
      if (res.error) {
        this._projectsError = res.error.includes('PAT') ?
          'A Personal Access Token is required. Set it in your account settings.' :
          `Could not load projects: ${res.error}`;
      } else {
        this._projects = res.projects || [];
      }
    } catch (e) {
      this._projectsError = String(e);
    } finally {
      this._projectsLoading = false;
    }
  }

  async _fetchWikis(project) {
    if (!project) return;
    this._wikisLoading = true;
    this._wikisError   = '';
    this._wikis        = [];
    this._wikiPages    = [];
    try {
      const res = await adminProvider.browseWikis(project);
      if (res.error) {
        this._wikisError = `Could not load wikis: ${res.error}`;
      } else {
        this._wikis = res.wikis || [];
        // Auto-select if only one wiki, or re-select previously saved one
        if (this._wikis.length === 1 && !this._wikiId) {
          this._wikiId = this._wikis[0].name;
        }
        // If a wiki is already selected, fetch its pages
        if (this._wikiId) this._fetchWikiPages(project, this._wikiId);
      }
    } catch (e) {
      this._wikisError = String(e);
    } finally {
      this._wikisLoading = false;
    }
  }

  async _fetchWikiPages(project, wikiId) {
    if (!project || !wikiId) return;
    this._wikiPagesLoading = true;
    this._wikiPagesError   = '';
    try {
      const res = await adminProvider.browseWikiPages(project, wikiId);
      if (res.error) {
        this._wikiPagesError = `Could not load pages: ${res.error}`;
      } else {
        this._wikiPages = res.pages || [];
      }
    } catch (e) {
      this._wikiPagesError = String(e);
    } finally {
      this._wikiPagesLoading = false;
    }
  }

  _validate() {
    const errs = {};
    if (this._backend === 'ado_wiki') {
      if (!this._wikiProject.trim())
        errs.project  = 'ADO Project is required';
      if (!this._wikiId.trim())
        errs.wiki_id  = 'Wiki ID is required';
      if (!this._wikiPagePath.trim())
        errs.page_path = 'Page Path is required';
    }
    this._validationErrors = errs;
    return Object.keys(errs).length === 0;
  }

  async _save() {
    if (!this._validate()) {
      this._statusMsg  = 'Please fix the errors below';
      this._statusType = 'error';
      return;
    }

    const cfg = { event_backend: this._backend };
    if (this._backend === 'ado_wiki') {
      cfg.ado_wiki = {
        project:   this._wikiProject.trim(),
        wiki_id:   this._wikiId.trim(),
        page_path: this._wikiPagePath.trim() || '/PlannerTool/Events',
      };
    }

    this._statusMsg  = 'Saving…';
    this._statusType = '';
    try {
      await adminProvider.saveEventsConfig(cfg);
      this._statusMsg  = 'Saved. Restart the server for the backend change to take effect.';
      this._statusType = 'success';
    } catch (e) {
      this._statusMsg  = 'Error saving';
      this._statusType = 'error';
    }
  }

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  /**
   * Render a locked (informational) domain row.
   * @param {string} label
   * @param {string} description
   * @param {string} backend  Display name for the current backend
   * @param {string} [note]   Optional secondary note
   */
  _lockedRow(label, description, backend, note = '') {
    return html`
      <tr>
        <td>
          <div class="domain-name">${label}</div>
          ${description ? html`<div class="domain-desc">${description}</div>` : ''}
        </td>
        <td>
          <span class="locked-badge">🔒 ${backend}</span>
          ${note ? html`<div class="locked-note">${note}</div>` : ''}
        </td>
      </tr>`;
  }

  _renderEventsRow() {
    const isWiki = this._backend === 'ado_wiki';
    const errs   = this._validationErrors;

    return html`
      <tr>
        <td>
          <div class="domain-name">Plan Events</div>
          <div class="domain-desc">
            Timeline markers tied to a plan — milestones, releases, code freezes.
          </div>
        </td>
        <td>
          <div class="backend-select-wrap">

            <select
              class="backend-select"
              @change=${(e) => {
                this._backend          = e.target.value;
                this._validationErrors = {};
                this._statusMsg        = '';
                if (this._backend === 'ado_wiki' && this._projects.length === 0) {
                  this._fetchProjects();
                }
              }}
            >
              <option value="local"    ?selected=${this._backend === 'local'}>
                Local database (PlannerTool)
              </option>
              <option value="ado_wiki" ?selected=${this._backend === 'ado_wiki'}>
                Azure DevOps Wiki page
              </option>
            </select>

            ${isWiki ? html`
              <div class="sub-form">
                <div class="field">
                  <label>ADO Project *</label>
                  <div class="desc">Azure DevOps project name.</div>
                  ${this._projectsLoading ? html`<div class="desc">Loading projects…</div>` : ''}
                  ${this._projectsError   ? html`<div class="error-msg">${this._projectsError}</div>` : ''}
                  ${this._projects.length > 0 ? html`
                    <select
                      class=${errs.project ? 'error' : ''}
                      @change=${(e) => {
                        this._wikiProject = e.target.value;
                        this._wikiId = '';
                        if (this._wikiProject) this._fetchWikis(this._wikiProject);
                      }}
                    >
                      <option value="">-- Select project --</option>
                      ${this._projects.map(p => html`
                        <option value=${p} ?selected=${this._wikiProject === p}>${p}</option>
                      `)}
                    </select>` : html`
                    <input type="text"
                      class=${errs.project ? 'error' : ''}
                      .value=${this._wikiProject}
                      placeholder="e.g. MyProject"
                      @input=${(e) => {
                        this._wikiProject = e.target.value;
                        this._wikiId = '';
                      }}
                    />`}
                  ${errs.project ? html`<div class="error-msg">${errs.project}</div>` : ''}
                </div>

                <div class="field">
                  <label>Wiki *</label>
                  <div class="desc">
                    Typically <em>&lt;ProjectName&gt;.wiki</em> for the project wiki.
                  </div>
                  ${this._wikisLoading ? html`<div class="desc">Loading wikis…</div>` : ''}
                  ${this._wikisError   ? html`<div class="error-msg">${this._wikisError}</div>` : ''}
                  ${this._wikis.length > 0 ? html`
                    <select
                      class=${errs.wiki_id ? 'error' : ''}
                      @change=${(e) => {
                        this._wikiId = e.target.value;
                        this._wikiPages = [];
                        if (this._wikiId) this._fetchWikiPages(this._wikiProject, this._wikiId);
                      }}
                    >
                      <option value="">-- Select wiki --</option>
                      ${this._wikis.map(w => html`
                        <option value=${w.name} ?selected=${this._wikiId === w.name}>
                          ${w.name} (${w.type || 'wiki'})
                        </option>
                      `)}
                    </select>` : html`
                    <input type="text"
                      class=${errs.wiki_id ? 'error' : ''}
                      .value=${this._wikiId}
                      placeholder="e.g. MyProject.wiki"
                      @input=${(e) => { this._wikiId = e.target.value; }}
                    />`}
                  ${errs.wiki_id ? html`<div class="error-msg">${errs.wiki_id}</div>` : ''}
                </div>

                <div class="field full">
                  <label>Page Path</label>
                  <div class="desc">
                    Wiki page path where events are stored.
                    The page itself is created automatically on first write —
                    but its parent must already exist.
                    ${this._wikiPagesLoading ? html` <em>Loading pages…</em>` : ''}
                    ${this._wikiPages.length > 0 && !this._wikiPagesLoading
                      ? html` Type to filter existing pages or enter a new path.` : ''}
                  </div>
                  ${this._wikiPagesError ? html`<div class="error-msg">${this._wikiPagesError}</div>` : ''}
                  <div class="page-combo">
                    <input type="text"
                      class=${errs.page_path ? 'error' : ''}
                      .value=${this._wikiPagePath}
                      placeholder="/PlannerTool/Events"
                      autocomplete="off"
                      @focus=${() => { this._pageDropdownOpen = true; }}
                      @input=${(e) => {
                        this._wikiPagePath     = e.target.value;
                        this._pageFilter       = e.target.value.toLowerCase();
                        this._pageDropdownOpen = true;
                      }}
                      @blur=${() => {
                        // Delay so a click on an option registers first
                        setTimeout(() => { this._pageDropdownOpen = false; }, 150);
                      }}
                    />
                    ${this._pageDropdownOpen && this._wikiPages.length > 0 ? (() => {
                      const filter  = this._pageFilter;
                      const matches = filter
                        ? this._wikiPages.filter(p => p.toLowerCase().includes(filter))
                        : this._wikiPages;
                      if (!matches.length) return '';
                      return html`
                        <div class="page-suggestions">
                          ${matches.slice(0, 60).map(p => html`
                            <div class="page-suggestion-item"
                              @mousedown=${() => {
                                this._wikiPagePath     = p;
                                this._pageFilter       = '';
                                this._pageDropdownOpen = false;
                              }}
                            >${p}</div>
                          `)}
                        </div>`;
                    })() : ''}
                  </div>
                  ${errs.page_path ? html`<div class="error-msg">${errs.page_path}</div>` : ''}
                </div>
              </div>` : ''}

          </div>
        </td>
      </tr>`;
  }

  render() {
    if (this._loading) {
      return html`<div class="loading">Loading data sources…</div>`;
    }

    const hasAlternativeBackend = this._backend !== 'local';

    return html`
      <h2>Data Sources</h2>
      <div class="panel">

        <table class="domain-table">
          <thead>
            <tr>
              <th style="width: 40%">Domain</th>
              <th>Backend</th>
            </tr>
          </thead>
          <tbody>
            ${this._lockedRow(
              'Work Items (Tasks, Epics, Features…)',
              'Features, epics, and tasks fetched from the remote work-item system.',
              'Azure DevOps / Mock',
              'Governed by Azure DevOps Configuration.'
            )}
            ${this._lockedRow(
              'Work Item History',
              'Revision history for individual work items.',
              'Azure DevOps / Mock',
              'Governed by Azure DevOps Configuration.'
            )}
            ${this._lockedRow(
              'Delivery Plans & Iterations',
              'Delivery plans, sprints, and iteration paths.',
              'Azure DevOps / Mock',
              'Governed by Azure DevOps Configuration.'
            )}
            ${this._lockedRow(
              'Scenarios',
              'User-scoped what-if overrides — dates, capacity, state.',
              'Local database'
            )}
            ${this._lockedRow(
              'Views',
              'Saved timeline view state (zoom, filters, selected projects).',
              'Local database'
            )}
            ${this._lockedRow(
              'People',
              'Team-member roster and capacity data.',
              'Local database'
            )}
            ${this._lockedRow(
              'Projects & Teams',
              'Project map and team definitions used for data loading and filtering.',
              'Local database'
            )}
            ${this._renderEventsRow()}
          </tbody>
        </table>

        ${hasAlternativeBackend ? html`
          <div class="restart-notice">
            <span class="icon">⚠</span>
            <div>
              <strong>Server restart required.</strong>
              The backend selection is read once at startup.
              After saving, restart the server process for the change to take effect.
            </div>
          </div>` : ''}

        <div class="actions">
          <button class="primary" @click=${this._save}>Save</button>
          <span class="status ${this._statusType}">${this._statusMsg}</span>
        </div>

      </div>`;
  }
}

customElements.define('admin-data-sources', DataSources);
