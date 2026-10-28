// providerREST.js
// REST API implementation of the BackendProvider interface (stub)
import { bus } from '../core/EventBus.js';
import { DataEvents, SessionEvents } from '../core/EventRegistry.js';
import { RestProviderBase } from './RestProviderBase.js';
import { ok, fail } from './result.js';
import { store } from '../application/store.js';
import { createUiCommands } from '../application/commands/uiCommands.js';
import { isMutableScenario } from '../application/shared/scenarioMutations.js';
import { clearPatRecoveryNotifications, createAuthRecovery } from './authRecovery.js';
import { resetAccountContext } from './authClient.js';

const uiCommands = createUiCommands(store, bus);

/**
 * @template T
 * @typedef {{ ok: true, data: T } | { ok: false, error: any }} Result
 */

export class ProviderREST extends RestProviderBase {
  constructor({ authentication = null, onAccountChanged = resetAccountContext } = {}) {
    const recovery = createAuthRecovery({
      authentication,
      acquireSession: async () => {
        const previous = this._accountEmail;
        await this.acquireSession();
        return previous === null || previous === this._accountEmail;
      },
      onSessionError: (error) => bus.emit(SessionEvents.EXPIRED, {
        ok: false,
        error: String(error),
        message:
          'Session could not be reacquired. Please sign in again or contact your administrator.',
      }),
    });
    super({
      authentication,
      retry: true,
      session: true,
      networkRetryCount: 2,
      networkRetryDelay: 1000,
      onSessionExpired: recovery.onSessionExpired,
      onCredentialFailure: recovery.onCredentialFailure,
      onResponse: (response, context) => this._recordResponse(response, context.url, context),
      onNetworkError: (err) => uiCommands.addNotification({
        source: 'Network', code: 'network_unreachable', severity: 'error',
        message: err instanceof Error ? err.message : String(err),
      }),
    });
    this._recovery = recovery;
    this._accountEmail = null;
    this._onAccountChanged = onAccountChanged;
  }
  // Initialize provider and acquire a session. Init should only perform
  // overall initialization; actual session acquisition is factored into
  // `acquireSession` so callers can re-acquire without triggering full
  // client-side reloads that would wipe WIP scenario data.
  async init() {
    await this.acquireSession();
  }

  async signOut() {
    if (this._authentication !== null) return this._authentication.logout();
    return this._signOutEnrollment();
  }

  async _signOutEnrollment() {
    const response = await this._fetch('/api/auth/logout', { method: 'POST' }, 0, false);
    if (!response.ok) throw new Error(`Sign out failed: ${response.status}`);
    this._accountEmail = null;
    clearPatRecoveryNotifications();
    bus.emit(SessionEvents.CHANGED);
  }

  async deleteAccount(email, accountKey) {
    const response = await this._fetch('/api/auth/delete-account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, accountKey, confirm: true }),
    }, this._networkRetryCount, false);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(typeof error.detail === 'string'
        ? error.detail : `Account deletion failed: ${response.status}`);
    }
    this._accountEmail = null;
    clearPatRecoveryNotifications();
    bus.emit(SessionEvents.CHANGED);
  }

  // Renew from the remembered device before loading any application data.
  async acquireSession() {
    if (this._authentication !== null) {
      const state = await this._authentication.status();
      if (state.status === 'signed_out' || state.status === 'session_expired') {
        const { showAuthDialog } = await import('../components/AuthDialog.lit.js');
        await showAuthDialog(this._resolveUrl('/api'), this._authentication);
        return this._authentication.state.account !== null;
      }
      return true;
    }
    return this._acquireEnrollmentSession();
  }

  async _acquireEnrollmentSession() {
    let response = await this._fetch('/api/session', { method: 'POST' }, 0, false);
    if (response.status === 401) {
      await this._recovery.login(this._resolveUrl('/api'));
      response = await this._fetch('/api/auth/me', { safeRead: false }, 0, false);
    }
    if (!response.ok) {
      throw new Error(`Session renewal failed: ${response.status}`);
    }
    const account = await response.json();
    if (this._accountEmail !== account.email) {
      if (this._accountEmail !== null) {
        this._identityInvalidated = true;
        await this._onAccountChanged({ previous: this._accountEmail, next: account.email });
      }
      this._accountEmail = account.email;
      clearPatRecoveryNotifications();
      bus.emit(SessionEvents.CHANGED);
    }
    const { ProviderLocalStorage } = await import('./providerLocalStorage.js');
    await new ProviderLocalStorage().setLocalPref('user.email', account.email);
  }

  /**
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<Result<any>>}
   */
  async _requestJson(url, options = {}) {
    const result = await this._fetchJson(url, {
      ...options,
      headers: this._headers(options.headers),
    });
    if (result.ok) {
      // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
      const payload = result.data;
      if (payload !== null && typeof payload === 'object' && payload.ok === false) {
        const errors = payload.errors instanceof Array ? payload.errors : [];
        if (errors.length === 0) {
          uiCommands.addNotification({ source: 'Backend', code: 'operation_failed', severity: 'error',
            message: typeof payload.message === 'string' ? payload.message : `Operation failed: ${url}` });
        }
        for (const error of errors) {
          uiCommands.addNotification({ source: 'Backend', code: 'operation_failed', severity: 'error',
            message: typeof error === 'string' ? error : error.message });
        }
      }
    } else if (result.error.message === 'Invalid JSON response'
      || result.error.message === 'Invalid response object') {
      uiCommands.addNotification({ source: 'Backend', code: 'invalid_response', severity: 'error',
        message: `${url}: ${result.error.message}` });
    }
    return result;
  }

  async _recordResponse(response, url, context = {}) {
    if (context.credentialFailure) return;
    const diagnostics = response.headers.get('X-Backend-Diagnostics');
    if (diagnostics !== null) {
      try {
        for (const diagnostic of JSON.parse(diagnostics)) {
          uiCommands.addNotification({ ...diagnostic, source: 'Backend' });
        }
      } catch (error) {
        console.error('Invalid backend diagnostics', { url, error });
        uiCommands.addNotification({ source: 'Backend', code: 'invalid_diagnostics', severity: 'error',
          message: `Invalid diagnostics received from ${url}` });
      }
    }
    if (response.ok) return;
    let message = `HTTP ${response.status}: ${url}`;
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    try {
      const payload = await response.clone().json();
      const detail = payload.detail === undefined ? payload : payload.detail;
      if (typeof detail === 'string') message = detail;
      else if (detail !== null && typeof detail === 'object' && typeof detail.message === 'string') {
        message = detail.message;
      }
    } catch (error) {
      console.error('Could not parse failed REST response', { url, status: response.status, error });
    }
    uiCommands.addNotification({ source: 'Backend', code: `http_${response.status}`, severity: 'error', message });
  }

  /**
   * @param {HeadersInit|undefined} extra
   * @returns {Record<string, string>}
   */
  _headers(extra = undefined) {
    const h = /** @type {Record<string, string>} */ (Object.assign({}, extra || {}));
    // Signal that we prefer JSON responses from the server
    if (!h['Accept']) h['Accept'] = 'application/json';
    return h;
  }

  async getCapabilities() {
    // Example: fetch capabilities via REST API (stub)
    // return fetch('/api/capabilities').then(res => res.json());
    return ok({
      scenariosPersisted: true,
      colorsPersisted: true,
      batchUpdates: true,
    });
  }

  async listScenarios() {
    const result = await this._requestJson('/api/scenario');
    if (!result.ok) return result;
    const list = Array.isArray(result.data) ? result.data : [];
    const normalized = list;
    bus.emit(DataEvents.SCENARIOS_CHANGED, normalized);
    console.log('providerREST:listScenarios:', normalized);
    return ok(normalized);
  }

  async loadAllScenarios() {
    const metasResult = await this.listScenarios();
    if (!metasResult.ok) return metasResult;

    const metas = Array.isArray(metasResult.data) ? metasResult.data : [];
    const scenarios = [];
    for (const m of metas) {
      // Load all scenarios from server (server should not send baseline, but we can handle it)
      if (!m || !m.id) continue;
      const scenarioResult = await this.getScenario(m.id);
      if (scenarioResult.ok && scenarioResult.data && typeof scenarioResult.data === 'object') {
        scenarios.push({ ...scenarioResult.data, id: String(scenarioResult.data.id) });
      }
    }
    bus.emit(DataEvents.SCENARIOS_DATA, scenarios);
    console.log('providerREST:loadAllScenarios - Fetched scenarios:', scenarios);
    return ok(scenarios);
  }

  async getScenario(id) {
    const result = await this._requestJson(`/api/scenario?id=${encodeURIComponent(id)}`);
    if (!result.ok) return result;
    console.log('providerREST:getScenario - Fetched scenario:', result.data);
    return ok(result.data);
  }

  async saveScenario(scenario) {
    // Client-side guard: Don't attempt to save readonly scenarios
    if (!isMutableScenario(scenario)) {
      console.warn('[providerREST] Attempted to save readonly scenario:', scenario.id);
      return fail({ message: 'Cannot save readonly scenario' });
    }

    const result = await this._requestJson('/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'save', data: scenario }),
    });
    if (!result.ok) return result;

    // I don't think listng is needed. Listing the scenarios does not add information
    // the application does not already have.
    //const listResult = await this.listScenarios();
    //if (listResult.ok) {
    //  bus.emit(DataEvents.SCENARIOS_CHANGED, listResult.data);
    //}
    console.log('providerREST:saveScenario:', result.data);
    return ok(result.data);
  }

  async deleteScenario(id) {
    const result = await this._requestJson('/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', data: { id } }),
    });
    if (!result.ok) return result;

    const didDelete = !!result.data?.ok;
    if (didDelete) {
      const listResult = await this.listScenarios();
      if (listResult.ok) {
        bus.emit(DataEvents.SCENARIOS_CHANGED, listResult.data);
      }
    }
    console.log('providerREST:deleteScenario:', result.data);
    return ok(didDelete);
  }

  async publishBaseline(selectedOverrides) {
    return this._requestJson('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectedOverrides),
    });
  }

  async updateTasksWithCapacity(updates) {
    // Send task updates with optional capacity data to /api/tasks
    // Expected format: [{ id, start?, end?, capacity?: [{team, capacity}] }]
    return this._requestJson('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  }

  async updateWorkItemCapacity(workItemId, capacity) {
    // Update capacity for a specific work item
    // Expected format: capacity is [{team: 'team-id', capacity: number}]
    return this._requestJson(`/api/tasks/${workItemId}/capacity`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capacity),
    });
  }

  async saveConfig(config) {
    return this._requestJson('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  }

  async checkHealth() {
    return this._requestJson('/api/health');
  }

  async getConfig() {
    // Example: fetch config from REST API (stub)
    // return fetch('/api/config').then(res => res.json());
    return ok({});
  }

  async getFeatures(project) {
    function getParent(f) {
      const parentRel = f.relations.find((r) => r.type === 'Parent');
      return parentRel ? parentRel.id : null;
    }

    try {
      const url =
        project ? `/api/tasks?project=${encodeURIComponent(project)}` : '/api/tasks';
      const result = await this._requestJson(url);
      if (!result.ok) return result;
      const tasks = result.data;
      // Calculate derived fields used in the frontend.
      const retval = (tasks || []).map((f) => ({
        ...f,
        parentId: getParent(f),
        original: { ...f },
        changedFields: [],
        dirty: false,
      }));
      return ok(retval);
    } catch (err) {
      uiCommands.addNotification({ source: 'Application', code: 'task_processing_failed', severity: 'error',
        message: err instanceof Error ? err.message : String(err) });
      return fail(err);
    }
  }

  async getTeams() {
    const result = await this._requestJson('/api/teams');
    if (!result.ok) return result;
    let retval = Array.isArray(result.data) ? result.data : [];
    retval = retval.map((team) => ({ ...team, selected: true }));
    return ok(retval);
  }

  async getProjects() {
    const result = await this._requestJson('/api/projects');
    if (!result.ok) return result;
    let retval = Array.isArray(result.data) ? result.data : [];
    retval = retval.filter((project) => project.archived !== true);
    retval = retval.map((project) => ({ ...project, selected: true }));
    console.log('providerREST:getProjects - Fetched projects:', retval);
    return ok(retval);
  }

  async getIterationsConfig() {
    const result = await this._requestJson('/api/iterations');
    if (!result.ok) return result;
    const data = result.data || {};
    return ok({
      iterationSetsById: data.iterationSetsById || {},
    });
  }

  async getIterationSets() {
    const payloadResult = await this.getIterationsConfig();
    if (!payloadResult.ok) return payloadResult;
    return ok(payloadResult.data.iterationSetsById || {});
  }

  // Request cost data for a required feature payload.
  async getCost(payload) {
    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload instanceof Array ||
      !(payload.features instanceof Array)
    ) {
      throw new TypeError('getCost requires a payload with a features array');
    }

    if (payload.features.length === 0) {
      return ok({ projects: [], months: [], teams: [] });
    }

    return this._requestJson('/api/cost/features', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async getCostTeams() {
    const result = await this._requestJson('/api/cost/teams');
    if (result.ok) {
      console.log('providerREST:getCostTeams - Fetched cost teams', result.data);
    }
    return result;
  }

  async getMarkers() {
    const result = await this._requestJson('/api/markers');
    if (result.ok) {
      console.log('providerREST:getMarkers - Fetched markers', result.data);
    }
    return result;
  }

  /**
   * Fetch plan events, optionally filtered by plan.
   * @param {string} [planId]
    * @returns {Promise<Result<Array<{id:string, date:string, title:string, plan_id:string}>>>}
   */
  async getEvents(planId) {
    const url = planId ? `/api/events?plan_id=${encodeURIComponent(planId)}` : '/api/events';
    return this._requestJson(url);
  }

  /**
   * Create a new plan event.
   * @param {{date:string, title:string, plan_id:string}} data
   */
  async createEvent(data) {
    return this._requestJson('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing plan event (partial).
   * @param {string} eventId
   * @param {{date?:string, title?:string, plan_id?:string}} data
   */
  async updateEvent(eventId, data) {
    return this._requestJson(`/api/events/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a plan event.
   * @param {string} eventId
   */
  async deleteEvent(eventId) {
    const result = await this._requestJson(`/api/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });
    if (!result.ok) return result;
    return ok(true);
  }

  /**
   * Fetch all event categories.
    * @returns {Promise<Result<Array>>}
   */
  async getEventCategories() {
    return this._requestJson('/api/event-categories');
  }

  /**
   * Create a new event category.
   * @param {{name: string, is_special?: boolean}} data
   */
  async createEventCategory(data) {
    return this._requestJson('/api/event-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing event category.
   * @param {string} categoryId
   * @param {{name?: string, is_special?: boolean}} data
   */
  async updateEventCategory(categoryId, data) {
    return this._requestJson(`/api/event-categories/${encodeURIComponent(categoryId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete an event category.
   * @param {string} categoryId
   */
  async deleteEventCategory(categoryId) {
    const result = await this._requestJson(`/api/event-categories/${encodeURIComponent(categoryId)}`, {
      method: 'DELETE',
    });
    if (!result.ok) return result;
    return ok(true);
  }

  /**
   * Fetch history entries for a given project.
   * @param {string} projectId
   * @param {{per_page?:number, invalidate_cache?:boolean}} [opts]
   */
  async getHistory(projectId, opts) {
    const perPage = opts && opts.per_page ? opts.per_page : 500;
    const invalidate = opts && opts.invalidate_cache ? '&invalidate_cache=true' : '';
    const url = `/api/history/tasks?project=${encodeURIComponent(projectId)}&per_page=${perPage}${invalidate}`;
    const result = await this._requestJson(url);
    if (!result.ok) return result;
    return ok(result.data || { tasks: [] });
  }

  async refreshTasks() {
    return this._requestJson('/api/tasks/refresh', { method: 'POST' });
  }

  async invalidateCache() {
    const result = await this._requestJson('/api/cache/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (result.ok) {
      console.log('providerREST:invalidateCache - Cache invalidated', result.data);
    }
    return result;
  }

  // ========== View Management ==========

  async listViews() {
    return this._requestJson('/api/view', { method: 'GET' });
  }

  async getView(id) {
    return this._requestJson(`/api/view?id=${id}`, { method: 'GET' });
  }

  async saveView(view) {
    const result = await this._requestJson('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'save', data: view }),
    });
    if (result.ok) {
      console.log('providerREST:saveView - Saved view:', result.data);
    }
    return result;
  }

  async renameView(id, name) {
    try {
      // Load existing view, update name, save back
      const viewResult = await this.getView(id);
      if (!viewResult.ok || !viewResult.data) {
        return fail({ message: 'View not found' });
      }
      const view = { ...viewResult.data, name };
      const result = await this._requestJson('/api/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'save', data: view }),
      });
      if (!result.ok) return result;
      console.log('providerREST:renameView - Renamed view:', result.data);
      return result;
    } catch (err) {
      return fail(err);
    }
  }

  async deleteView(id) {
    const result = await this._requestJson('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', data: { id } }),
    });
    if (!result.ok) return result;
    const didDelete = !!result.data?.ok;
    console.log('providerREST:deleteView - Deleted view:', result.data);
    return ok(didDelete);
  }

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  /**
   * List all groups, optionally filtered by plan_id.
   * @param {string} [planId]
    * @returns {Promise<Result<Array>>}
   */
  async listGroups(planId) {
    const qs = planId ? `?plan_id=${encodeURIComponent(planId)}` : '';
    return this._requestJson(`/api/groups${qs}`);
  }

  /**
   * Create a new group.
   * @param {{ plan_id:string, name:string, color?:string, rank?:number }} payload
    * @returns {Promise<Result<object>>}
   */
  async createGroup(payload) {
    return this._requestJson('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /**
   * Update an existing group.
   * @param {string} groupId
   * @param {{ name?:string, color?:string, rank?:number }} fields
    * @returns {Promise<Result<object>>}
   */
  async updateGroup(groupId, fields) {
    return this._requestJson(`/api/groups/${encodeURIComponent(groupId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
  }

  /**
   * Delete a group (server cascades sub-groups).
   * @param {string} groupId
    * @returns {Promise<Result<boolean>>}
   */
  async deleteGroup(groupId) {
    const result = await this._requestJson(`/api/groups/${encodeURIComponent(groupId)}`, {
      method: 'DELETE',
    });
    if (!result.ok) return result;
    return ok(true);
  }

  /**
   * Fetch runtime plugin configuration from the backend.
    * Returns an object: {schema_version, plugins:[...]} in Result envelope.
    * @returns {Promise<Result<object>>}
   */
  async getPluginsConfig() {
    const result = await this._requestJson('/api/plugins/config');
    if (!result.ok) return result;
    const j = result.data;
    if (j && typeof j === 'object' && j.schema_version === 2 && j.plugins instanceof Array) {
      return ok(j);
    }
    return fail({ message: 'Invalid plugins config payload' });
  }

  async getPluginsSchemas() {
    const result = await this._requestJson('/api/plugins/schemas');
    if (!result.ok) return result;
    const j = result.data;
    if (j && typeof j === 'object') {
      return ok(j);
    }
    return fail({ message: 'Invalid plugin schemas payload' });
  }
}
