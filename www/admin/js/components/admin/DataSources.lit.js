import { getAuthentication } from '../../../../js/services/authStartup.js';
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
import { renderGroupsRow } from './datasources/groups-row.js';

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
 *   • Table shell, locked domain rows (Scenarios, Views, Workforce, Projects)
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
};

// UI option values mapped to the persisted ado_config.transport.
const TRANSPORT_BY_TYPE = {
  ado_live: 'live',
  ado_mock_fixture: 'mock_fixture',
  ado_mock_generator: 'mock_generator',
  ado_static: 'static',
};

/**
 * @param {string} transport persisted ado_config.transport
 * @returns {'ado_static'|'ado_mock_generator'|'ado_mock_fixture'|'ado_live'}
 */
function backendTypeFromTransport(transport) {
  const type = Object.keys(TRANSPORT_BY_TYPE).find(key => TRANSPORT_BY_TYPE[key] === transport);
  if (type === undefined) throw new Error(`Unknown ADO transport: ${transport}`);
  return type;
}

function resultErrorMessage(result, fallback = 'Request failed') {
  if (result?.error?.message) return result.error.message;
  if (typeof result?.error === 'string') return result.error;
  return fallback;
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
    mode: { type: String },
    authentication: { attribute: false },
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

    // ---- Task backend selection ---------------------------------------
    _taskBackends:        { type: Array,   state: true },
    _taskBackendId:       { type: String,  state: true },
    _savedTaskBackendId:  { type: String,  state: true },
    _activeTaskBackendId: { type: String,  state: true },
    _restartAvailable:   { type: Boolean, state: true },
    _restarting:         { type: Boolean, state: true },

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

    // ---- Groups backend selection -------------------------------------
    _groupsBackend:       { type: String,  state: true },

    // ---- UI state ------------------------------------------------------
    _validationErrors:    { type: Object,  state: true },
    _statusMsg:           { type: String,  state: true },
    _statusType:          { type: String,  state: true },
  };

  constructor() {
    super();
    this.authentication = getAuthentication();
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

    // Task backend
    this._taskBackends        = [];
    this.mode                 = 'generic';
    this._taskBackendId       = 'ado';
    this._savedTaskBackendId  = 'ado';
    this._activeTaskBackendId = 'ado';
    this._restartAvailable   = false;
    this._restarting         = false;
    this._serverInstanceId   = '';

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

    this._groupsBackend       = 'local';

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
      const adoView = this.mode === 'ado';
      const [evtCfgResult, adoCfgResult, sysCfgResult, grpCfgResult, backendsResult] = await Promise.all([
        adoView ? null : adminProvider.getEventsConfig(),
        adoView ? adminProvider.getAdo() : null,
        adminProvider.getSystem(),
        adoView ? null : adminProvider.getGroupsConfig(),
        adminProvider.getTaskBackends(),
      ]);

      if (!adoView && !evtCfgResult.ok) throw new Error(resultErrorMessage(evtCfgResult, 'Failed to load events config'));
      if (adoView && !adoCfgResult.ok) throw new Error(resultErrorMessage(adoCfgResult, 'Failed to load ADO config'));
      if (!sysCfgResult.ok) throw new Error(resultErrorMessage(sysCfgResult, 'Failed to load system config'));
      if (!adoView && !grpCfgResult.ok) throw new Error(resultErrorMessage(grpCfgResult, 'Failed to load groups config'));
      if (!backendsResult.ok) throw new Error(resultErrorMessage(backendsResult, 'Failed to load task backends'));

      this._taskBackends       = backendsResult.data.backends;
      this._taskBackendId      = backendsResult.data.configured;
      this._savedTaskBackendId = backendsResult.data.configured;
      this._activeTaskBackendId = backendsResult.data.active;
      this._restartAvailable = backendsResult.data.restart_available;
      this._serverInstanceId = backendsResult.data.instance_id;

      const evtCfg = adoView ? null : evtCfgResult.data;
      const adoCfg = adoView ? adoCfgResult.data : null;
      const sysCfg = sysCfgResult.data;
      const grpCfg = adoView ? null : grpCfgResult.data;

      // ---- Groups -------------------------------------------------------
      if (grpCfg) {
        this._groupsBackend = grpCfg.groups_backend || 'local';
      }

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
      if (this._activeTaskBackendId === 'ado' && this._eventsBackend === 'ado_wiki') {
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
        this._adoBackendType = backendTypeFromTransport(adoCfg.transport);

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

  _fetchProjects() {
    if (this._activeTaskBackendId === 'ado') return fetchProjects(this);
  }
  _fetchWikis(project) {
    if (this._activeTaskBackendId === 'ado') return fetchWikis(this, project);
  }
  _fetchWikiPages(project, wikiId) {
    if (this._activeTaskBackendId === 'ado') return fetchWikiPages(this, project, wikiId);
  }

  // ------------------------------------------------------------------
  // Validation & Save
  // ------------------------------------------------------------------

  _validate() {
    const errs = {};

    // ADO backend validation
    const ado = this.mode === 'ado';
    if (ado && this._adoBackendType === 'ado_live' && !this._orgUrl.trim())
      errs.orgUrl = 'Organization Name is required for Live ADO backend';
    if (ado && this._adoBackendType === 'ado_mock_fixture' && !this._fixtureDir.trim())
      errs.fixtureDir = 'Fixture data directory is required';
    if (ado && this._adoBackendType === 'ado_static' && !this._staticDataPath.trim())
      errs.staticDataPath = 'Static data file path is required';

    // Plan Events validation
    if (this._eventsBackend === 'ado_wiki') {
      if (!this._wikiOrgUrl.trim())   errs.evtOrgUrl   = 'Organization Name is required';
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
      if (this.mode !== 'ado') await this._saveCommonSources();
      else await this._saveAdoSource();

      const ttlsToSave = {};
      for (const [key, val] of Object.entries(this._ttls)) ttlsToSave[key] = Number(val);
      const sysPayload = {
        ...this._systemContent,
        task_backend_id: this._taskBackendId,
        cache: { ...this._systemContent.cache, ttls: ttlsToSave },
      };
      const systemSaveResult = await adminProvider.saveSystem(sysPayload);
      if (!systemSaveResult.ok) {
        throw new Error(resultErrorMessage(systemSaveResult, 'Failed to save system config'));
      }
      this._savedTaskBackendId = this._taskBackendId;
      this._savedAdoBackendType = this._adoBackendType;
      this._savedEventsBackend = this._eventsBackend;
      this._systemContent = sysPayload;
      this._statusMsg = 'Saved.';
      this._statusType = 'success';
    } catch (error) {
      this._statusMsg = `Error saving: ${error.message}`;
      this._statusType = 'error';
    }
  }

  async _saveCommonSources() {
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
      const eventsSaveResult = await adminProvider.saveEventsConfig(evtCfg);
      if (!eventsSaveResult?.ok) {
        throw new Error(resultErrorMessage(eventsSaveResult, 'Failed to save events config'));
      }

      // 1b. Save Groups config
      const groupsSaveResult = await adminProvider.saveGroupsConfig({
        groups_backend: this._groupsBackend,
      });
      if (!groupsSaveResult?.ok) {
        throw new Error(resultErrorMessage(groupsSaveResult, 'Failed to save groups config'));
      }
  }

  async _saveAdoSource() {
      // 2. Save ADO config — backend selection + org URL + all sub-configs.
      // Sub-config values are always persisted (not just for the active backend)
      // so switching back retains the last-entered values.
      const newFlags = { ...this._adoFlags };
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
        transport: TRANSPORT_BY_TYPE[this._adoBackendType],
        feature_flags: newFlags,
      };
      const adoSaveResult = await adminProvider.saveAdo(adoPayload);
      if (!adoSaveResult?.ok) {
        throw new Error(resultErrorMessage(adoSaveResult, 'Failed to save ADO config'));
      }

      this._adoContent = adoPayload;
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

  /** Render the task backend selector; inactive backends keep their settings. */
  _taskBackendRow() {
    return html`
      <tr>
        <td>
          <div class="domain-name">Task Backend</div>
          <div class="domain-desc">The one system that owns work items. Switching keeps the other backend's settings.</div>
        </td>
        <td>
          <select class="task-backend-select"
            @change=${(e) => {
              this._taskBackendId    = e.target.value;
              this._validationErrors = {};
              this._statusMsg        = '';
            }}>
            ${this._taskBackends.map(backend => html`
              <option value=${backend.id}
                .selected=${backend.id === this._taskBackendId}
                ?disabled=${!backend.available}>
                ${backend.label}${backend.available ? '' : ' (not available yet)'}
              </option>`)}
          </select>
        </td>
        <td class="ttl-col"><span class="ttl-dash">—</span></td>
      </tr>`;
  }

  async _restartServer() {
    this._restarting = true;
    this._statusMsg = 'Restarting server…';
    this._statusType = '';
    try {
      const result = await adminProvider.restartServer();
      if (!result.ok) throw new Error(resultErrorMessage(result, 'Restart failed'));
      const target = this._savedTaskBackendId;
      const previousInstance = this._serverInstanceId;
      for (let attempt = 0; attempt < 30 && this.isConnected; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await adminProvider.getTaskBackends();
        if (status.ok && status.data.instance_id !== previousInstance && status.data.active === target) {
          window.location.reload();
          return;
        }
      }
      throw new Error('The server has not confirmed the restart. Check Data Sources again shortly.');
    } catch (error) {
      this._statusMsg = error.message;
      this._statusType = 'error';
    } finally {
      this._restarting = false;
    }
  }

  render() {
    if (this._loading) {
      return html`<div class="loading">Loading data sources…</div>`;
    }

    const needsRestart = this._taskBackendId  !== this._savedTaskBackendId ||
                         this._adoBackendType !== this._savedAdoBackendType ||
                         this._eventsBackend  !== this._savedEventsBackend;
              const pendingRestart = this._savedTaskBackendId !== this._activeTaskBackendId;

    return html`
      <h2>${this.mode === 'ado' ? 'Azure DevOps Connection' : 'Data Sources'}</h2>
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
            ${this.mode === 'ado' ? renderAdoGroup(this) : html`
            ${this._taskBackendRow()}
            ${this._lockedRow('Scenarios', 'User-scoped what-if overrides — dates, capacity, state.', 'Local database')}
            ${this._lockedRow('Views', 'Saved timeline view state (zoom, filters, selected projects).', 'Local database')}
            <tr>
              <td>
                <div class="domain-name">Workforce</div>
                <div class="domain-desc">Anonymous supplier profiles and team staffing.</div>
              </td>
              <td><span class="locked-badge">🔒 Local database</span></td>
              <td class="ttl-col"></td>
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
            ${renderGroupsRow(this)}`}
          </tbody>
        </table>

        ${needsRestart || pendingRestart ? html`
          <div class="restart-notice">
            <span class="icon">⚠</span>
            <div>
              <strong>Server restart required.</strong>
              ${needsRestart ? 'Save your changes first.' : (this._restartAvailable
                ? 'Restart the server to activate the saved backend.' : 'Restart is unavailable with this launcher.')}
            </div>
          </div>` : ''}

        <div class="actions">
          <button class="primary" ?disabled=${this._restarting} @click=${this._save}>Save</button>
          <button ?disabled=${this._restarting} @click=${this._load}>Cancel</button>
          ${this._restartAvailable ? html`
            <button data-restart-server ?disabled=${this._restarting || needsRestart} @click=${this._restartServer}>
              Restart server
            </button>` : ''}
          <span class="status ${this._statusType}">${this._statusMsg}</span>
        </div>

      </div>`;
  }
}

customElements.define('admin-data-sources', DataSources);
