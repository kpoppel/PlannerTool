import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';
import {
  backendSelectStyles,
  subFormStyles,
  ttlStyles,
  domainRowStyles,
} from './datasources/shared-styles.js';
import { renderAdoGroup } from './datasources/ado-row.js';
import {
  fetchProjects,
  fetchWikis,
  fetchWikiPages,
  renderPlanEventsRow,
} from './datasources/plan-events-row.js';

/**
 * DataSources — Admin panel for all data domains, backend choices, and cache TTLs.
 *
 * Three columns: Domain | Backend (+ inline sub-form) | Cache TTL (min)
 *
 * Rendering is split into focused sub-modules:
 *   datasources/ado-row.js         — Work Items / History / Iterations group
 *   datasources/plan-events-row.js — Plan Events row + wiki browse helpers
 *   datasources/shared-styles.js   — shared CSS fragments
 *
 * This file is responsible for:
 *   • Loading all config (events, ADO, system) in parallel
 *   • Holding all reactive state
 *   • Table shell, locked domain rows (Scenarios, Views, People, Teams)
 *   • Unified Save (three sequential endpoint calls)
 *   • Restart banner and status feedback
 *
 * This component intentionally does NOT use SchemaForm — conditional
 * sub-form visibility is handled with Lit's native conditional rendering.
 */

// Default TTL values (minutes) — mirrors CacheTTLConfig defaults in Python
const TTL_DEFAULTS = {
  fetch_tasks:      30,
  fetch_history:    1440,
  fetch_plans:      240,
  fetch_iterations: 480,
  fetch_markers:    120,
  fetch_teams:      240,
  fetch_people:     60,
};

/**
 * Derive a friendly backend-type key from ado_config feature_flags.
 * Priority matches BackendRegistry._priority_backends() order.
 * @param {object} flags
 * @returns {'ado_static'|'ado_mock_generator'|'ado_mock_fixture'|'ado_live'}
 */
function backendTypeFromFlags(flags = {}) {
  if (flags.use_static_backend)        return 'ado_static';
  if (flags.use_azure_mock_generator)  return 'ado_mock_generator';
  if (flags.use_azure_mock)            return 'ado_mock_fixture';
  return 'ado_live';
}

/**
 * Build a new feature_flags object for the given backend type.
 * All type-selection booleans are cleared; only the selected one is set true.
 * All other (non-type) flags and sub-configs are preserved from existingFlags.
 * @param {'ado_live'|'ado_mock_fixture'|'ado_mock_generator'|'ado_static'} type
 * @param {object} existingFlags
 * @returns {object}
 */
function buildFlagsForType(type, existingFlags = {}) {
  const next = { ...existingFlags };
  // Clear all type selectors
  delete next.use_static_backend;
  delete next.use_azure_mock_generator;
  delete next.use_azure_mock;
  // Set the chosen one (ado_live leaves no flag set — default fallback in registry)
  if (type === 'ado_static')         next.use_static_backend = true;
  if (type === 'ado_mock_generator') next.use_azure_mock_generator = true;
  if (type === 'ado_mock_fixture')   next.use_azure_mock = true;
  return next;
}

export class DataSources extends LitElement {
  static styles = [
    backendSelectStyles,
    subFormStyles,
    ttlStyles,
    domainRowStyles,
    css`
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

    /* TTL column — keep it compact */
    .domain-table th.ttl-col,
    .domain-table td.ttl-col {
      width: 130px;
      min-width: 110px;
      white-space: nowrap;
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
    `,
  ];

  static properties = {
    _loading:             { type: Boolean, state: true },

    // ---- Plan Events (ado_wiki) ----------------------------------------
    _eventsBackend:       { type: String,  state: true },
    _wikiOrgUrl:          { type: String,  state: true },
    _wikiProject:         { type: String,  state: true },
    _wikiId:              { type: String,  state: true },
    _wikiPagePath:        { type: String,  state: true },
    _projects:            { type: Array,   state: true },
    _projectsLoading:     { type: Boolean, state: true },
    _projectsError:       { type: String,  state: true },
    _wikis:               { type: Array,   state: true },
    _wikisLoading:        { type: Boolean, state: true },
    _wikisError:          { type: String,  state: true },
    _wikiPages:           { type: Array,   state: true },
    _wikiPagesLoading:    { type: Boolean, state: true },
    _wikiPagesError:      { type: String,  state: true },
    _pageFilter:          { type: String,  state: true },
    _pageDropdownOpen:    { type: Boolean, state: true },

    // ---- ADO backend selection -----------------------------------------
    _adoBackendType:      { type: String,  state: true },
    _orgUrl:              { type: String,  state: true },
    // Raw feature_flags preserved for round-trip (non-type flags untouched)
    _adoFlags:            { type: Object,  state: true },
    // Sub-config values per backend type
    _fixtureDir:          { type: String,  state: true },
    _fixturePersist:      { type: Boolean, state: true },
    _genPersistEnabled:   { type: Boolean, state: true },
    _genPersistDir:       { type: String,  state: true },
    _genSeed:             { type: String,  state: true },
    _genNPlans:           { type: String,  state: true },
    _genItemsPerArea:     { type: String,  state: true },
    _genNPis:             { type: String,  state: true },
    _genSprintsPerPi:     { type: String,  state: true },
    _genRevisionsMin:     { type: String,  state: true },
    _genRevisionsMax:     { type: String,  state: true },
    _staticDataPath:      { type: String,  state: true },

    // ---- Cache TTLs ----------------------------------------------------
    _ttls:                { type: Object,  state: true },

    // ---- Original content for safe round-trip saves -------------------
    _adoContent:          { type: Object,  state: true },
    _systemContent:       { type: Object,  state: true },

    // ---- Saved baseline values for restart-banner detection -----------
    _savedAdoBackendType: { type: String,  state: true },
    _savedEventsBackend:  { type: String,  state: true },

    // ---- UI state ------------------------------------------------------
    _validationErrors:    { type: Object,  state: true },
    _statusMsg:           { type: String,  state: true },
    _statusType:          { type: String,  state: true },
  };

  constructor() {
    super();
    this._loading             = false;

    // Plan Events
    this._eventsBackend       = 'local';
    this._wikiOrgUrl          = '';
    this._wikiProject         = '';
    this._wikiId              = '';
    this._wikiPagePath        = '/PlannerTool/Events';
    this._projects            = [];
    this._projectsLoading     = false;
    this._projectsError       = '';
    this._wikis               = [];
    this._wikisLoading        = false;
    this._wikisError          = '';
    this._wikiPages           = [];
    this._wikiPagesLoading    = false;
    this._wikiPagesError      = '';
    this._pageFilter          = '';
    this._pageDropdownOpen    = false;

    // ADO backend
    this._adoBackendType      = 'ado_live';
    this._orgUrl              = '';
    this._adoFlags            = {};
    this._fixtureDir          = 'data/azure_mock';
    this._fixturePersist      = false;
    this._genPersistEnabled   = false;
    this._genPersistDir       = '';
    this._genSeed             = '';
    this._genNPlans           = '6';
    this._genItemsPerArea     = '20';
    this._genNPis             = '6';
    this._genSprintsPerPi     = '4';
    this._genRevisionsMin     = '2';
    this._genRevisionsMax     = '12';
    this._staticDataPath      = '';

    // TTLs (defaults; overridden on load)
    this._ttls                = { ...TTL_DEFAULTS };

    // Round-trip originals
    this._adoContent          = {};
    this._systemContent       = {};

    // Saved baselines for restart banner
    this._savedAdoBackendType = 'ado_live';
    this._savedEventsBackend  = 'local';

    this._validationErrors    = {};
    this._statusMsg           = '';
    this._statusType          = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  async _load() {
    this._loading = true;
    try {
      const [evtCfg, adoCfg, sysCfg] = await Promise.all([
        adminProvider.getEventsConfig(),
        adminProvider.getAdo(),
        adminProvider.getSystem(),
      ]);

      // ---- Plan Events --------------------------------------------------
      if (evtCfg) {
        this._eventsBackend = evtCfg.event_backend || 'local';
        const wiki          = evtCfg.ado_wiki || {};
        this._wikiOrgUrl    = wiki.organization_url || '';
        this._wikiProject   = wiki.project   || '';
        this._wikiId        = wiki.wiki_id   || '';
        this._wikiPagePath  = wiki.page_path || '/PlannerTool/Events';
      }
      this._savedEventsBackend = this._eventsBackend;

      // Pre-populate browse lists when already on ado_wiki
      if (this._eventsBackend === 'ado_wiki') {
        this._fetchProjects();
        if (this._wikiProject) this._fetchWikis(this._wikiProject);
        if (this._wikiProject && this._wikiId)
          this._fetchWikiPages(this._wikiProject, this._wikiId);
      }

      // ---- ADO backend --------------------------------------------------
      if (adoCfg) {
        this._adoContent     = adoCfg;
        const flags          = adoCfg.feature_flags || {};
        this._adoFlags       = flags;
        this._orgUrl         = adoCfg.organization_url || '';
        this._adoBackendType = backendTypeFromFlags(flags);

        // Fixture mock sub-config
        this._fixtureDir     = flags.azure_mock_data_dir      || 'data/azure_mock';
        this._fixturePersist = Boolean(flags.azure_mock_persist_enabled);

        // Generator sub-config
        this._genPersistEnabled = Boolean(flags.generator_persist_enabled);
        this._genPersistDir     = flags.generator_persist_dir || '';
        const gc                = flags.generator_config || {};
        this._genSeed           = gc.seed                    != null ? String(gc.seed)                    : '';
        this._genNPlans         = gc.n_plans                 != null ? String(gc.n_plans)                 : '6';
        this._genItemsPerArea   = gc.default_items_per_area  != null ? String(gc.default_items_per_area)  : '20';
        this._genNPis           = gc.n_pis                   != null ? String(gc.n_pis)                   : '6';
        this._genSprintsPerPi   = gc.sprints_per_pi          != null ? String(gc.sprints_per_pi)          : '4';
        this._genRevisionsMin   = gc.revisions_min           != null ? String(gc.revisions_min)           : '2';
        this._genRevisionsMax   = gc.revisions_max           != null ? String(gc.revisions_max)           : '12';

        // Static backend sub-config
        this._staticDataPath = flags.static_data_path || '';
      }
      this._savedAdoBackendType = this._adoBackendType;

      // ---- TTLs ---------------------------------------------------------
      if (sysCfg) {
        this._systemContent = sysCfg;
        const stored = (sysCfg.cache || {}).ttls || {};
        this._ttls = { ...TTL_DEFAULTS, ...stored };
      }

    } catch (e) {
      this._statusMsg  = 'Error loading data sources configuration';
      this._statusType = 'error';
    } finally {
      this._loading = false;
    }
  }

  // ------------------------------------------------------------------
  // Browse helpers — delegated to plan-events-row.js
  // These are called from the Plan Events row's browse dropdowns.
  // ------------------------------------------------------------------

  _fetchProjects()                        { return fetchProjects(this); }
  _fetchWikis(project)                    { return fetchWikis(this, project); }
  _fetchWikiPages(project, wikiId)        { return fetchWikiPages(this, project, wikiId); }

  // ------------------------------------------------------------------
  // Validation & Save
  // ------------------------------------------------------------------

  _validate() {
    const errs = {};

    // ADO backend validation
    if (this._adoBackendType === 'ado_live' && !this._orgUrl.trim())
      errs.orgUrl = 'Organization URL is required for Live ADO backend';
    if (this._adoBackendType === 'ado_mock_fixture' && !this._fixtureDir.trim())
      errs.fixtureDir = 'Fixture data directory is required';
    if (this._adoBackendType === 'ado_static' && !this._staticDataPath.trim())
      errs.staticDataPath = 'Static data file path is required';

    // Plan Events validation
    if (this._eventsBackend === 'ado_wiki') {
      if (!this._wikiOrgUrl.trim())   errs.evtOrgUrl   = 'Organization URL is required';
      if (!this._wikiProject.trim()) errs.evtProject  = 'ADO Project is required';
      if (!this._wikiId.trim())      errs.evtWikiId   = 'Wiki ID is required';
      if (!this._wikiPagePath.trim()) errs.evtPagePath = 'Page Path is required';
    }

    // TTL range validation (1–10080 minutes)
    for (const [key, val] of Object.entries(this._ttls)) {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1 || n > 10080)
        errs[`ttl_${key}`] = `${key}: must be 1–10080`;
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

    this._statusMsg  = 'Saving…';
    this._statusType = '';

    try {
      // 1. Save Plan Events config
      const evtCfg = { event_backend: this._eventsBackend };
      if (this._eventsBackend === 'ado_wiki') {
        evtCfg.ado_wiki = {
          organization_url: this._wikiOrgUrl.trim(),
          project:          this._wikiProject.trim(),
          wiki_id:   this._wikiId.trim(),
          page_path: this._wikiPagePath.trim() || '/PlannerTool/Events',
        };
      }
      await adminProvider.saveEventsConfig(evtCfg);

      // 2. Save ADO config — backend selection + org URL + all sub-configs.
      // Sub-config values are always persisted (not just for the active backend)
      // so switching back retains the last-entered values.
      const newFlags = buildFlagsForType(this._adoBackendType, { ...this._adoFlags });
      newFlags.azure_mock_data_dir        = this._fixtureDir;
      newFlags.azure_mock_persist_enabled = this._fixturePersist;
      newFlags.generator_persist_enabled  = this._genPersistEnabled;
      if (this._genPersistDir.trim()) newFlags.generator_persist_dir = this._genPersistDir.trim();
      else delete newFlags.generator_persist_dir;
      const gc = {};
      if (this._genSeed.trim() !== '')  gc.seed                   = Number(this._genSeed);
      if (this._genNPlans !== '')       gc.n_plans                = Number(this._genNPlans);
      if (this._genItemsPerArea !== '') gc.default_items_per_area = Number(this._genItemsPerArea);
      if (this._genNPis !== '')         gc.n_pis                  = Number(this._genNPis);
      if (this._genSprintsPerPi !== '') gc.sprints_per_pi         = Number(this._genSprintsPerPi);
      if (this._genRevisionsMin !== '') gc.revisions_min          = Number(this._genRevisionsMin);
      if (this._genRevisionsMax !== '') gc.revisions_max          = Number(this._genRevisionsMax);
      if (Object.keys(gc).length) newFlags.generator_config = gc;
      else delete newFlags.generator_config;
      newFlags.static_data_path = this._staticDataPath;

      const adoPayload = {
        ...this._adoContent,
        organization_url: this._orgUrl.trim(),
        feature_flags: newFlags,
      };
      await adminProvider.saveAdo(adoPayload);

      // 3. Save TTLs into server_config.cache.ttls
      const ttlsToSave = {};
      for (const [key, val] of Object.entries(this._ttls))
        ttlsToSave[key] = Number(val);

      const sysPayload = {
        ...this._systemContent,
        cache: {
          ...(this._systemContent.cache || {}),
          ttls: ttlsToSave,
        },
      };
      await adminProvider.saveSystem(sysPayload);

      // Update saved baselines so the restart banner reflects the new state
      this._savedAdoBackendType = this._adoBackendType;
      this._savedEventsBackend  = this._eventsBackend;
      this._adoContent          = adoPayload;
      this._systemContent       = sysPayload;

      this._statusMsg  = 'Saved.';
      this._statusType = 'success';

    } catch (e) {
      this._statusMsg  = `Error saving: ${e}`;
      this._statusType = 'error';
    }
  }

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  /**
   * Render a TTL number input for the given cache key.
   * Called from ado-row.js (via comp._ttlInput) and from this render() for
   * the People and Teams rows.
   * @param {string} key  Key in TTL_DEFAULTS / this._ttls
   */
  _ttlInput(key) {
    const errKey = `ttl_${key}`;
    const errs   = this._validationErrors;
    return html`
      <div class="ttl-wrap">
        <input type="number"
          min="1" max="10080" step="1"
          class=${errs[errKey] ? 'error' : ''}
          .value=${String(this._ttls[key] ?? TTL_DEFAULTS[key])}
          @input=${(e) => { this._ttls = { ...this._ttls, [key]: e.target.value }; }}
        />
        <span class="ttl-unit">min</span>
      </div>
      ${errs[errKey] ? html`<div class="error-msg">${errs[errKey]}</div>` : ''}`;
  }

  /** Render a locked domain row (no backend selector, no TTL). */
  _lockedRow(label, description, backend) {
    return html`
      <tr>
        <td>
          <div class="domain-name">${label}</div>
          ${description ? html`<div class="domain-desc">${description}</div>` : ''}
        </td>
        <td><span class="locked-badge">🔒 ${backend}</span></td>
        <td class="ttl-col"><span class="ttl-dash">—</span></td>
      </tr>`;
  }

  render() {
    if (this._loading) {
      return html`<div class="loading">Loading data sources…</div>`;
    }

    const needsRestart = this._adoBackendType  !== this._savedAdoBackendType ||
                         this._eventsBackend   !== this._savedEventsBackend;

    return html`
      <h2>Data Sources</h2>
      <div class="panel">

        <table class="domain-table">
          <thead>
            <tr>
              <th style="width: 35%">Domain</th>
              <th>Backend</th>
              <th class="ttl-col">Cache TTL</th>
            </tr>
          </thead>
          <tbody>
            ${renderAdoGroup(this)}
            ${this._lockedRow('Scenarios', 'User-scoped what-if overrides — dates, capacity, state.', 'Local database')}
            ${this._lockedRow('Views', 'Saved timeline view state (zoom, filters, selected projects).', 'Local database')}
            <tr>
              <td>
                <div class="domain-name">People</div>
                <div class="domain-desc">Team-member roster and capacity data.</div>
              </td>
              <td><span class="locked-badge">🔒 Local database</span></td>
              <td class="ttl-col">${this._ttlInput('fetch_people')}</td>
            </tr>
            <tr>
              <td>
                <div class="domain-name">Projects &amp; Teams</div>
                <div class="domain-desc">Project map and team definitions used for data loading and filtering.</div>
              </td>
              <td><span class="locked-badge">🔒 Local database</span></td>
              <td class="ttl-col">${this._ttlInput('fetch_teams')}</td>
            </tr>
            ${renderPlanEventsRow(this)}
          </tbody>
        </table>

        ${needsRestart ? html`
          <div class="restart-notice">
            <span class="icon">⚠</span>
            <div>
              <strong>Server restart required.</strong>
              Backend selections are read once at startup.
              After saving, restart the server process for changes to take effect.
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
