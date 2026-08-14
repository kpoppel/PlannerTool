// providerREST.js
// REST API implementation of the BackendProvider interface (stub)
import { bus } from '../core/EventBus.js';
import { DataEvents, SessionEvents } from '../core/EventRegistry.js';
import { RestProviderBase } from './RestProviderBase.js';
import { ok, fail } from './result.js';

export class ProviderREST extends RestProviderBase {
  constructor() {
    super({
      retry: true,
      session: true,
      networkRetryCount: 2,
      networkRetryDelay: 1000,
      onSessionExpired: () => this._handleSessionExpiry(),
      onNetworkError: (err) => {
        bus.emit(SessionEvents.EXPIRED, {
          ok: false,
          error: {
            message: err instanceof Error ? err.message : String(err),
            code: 'network_unreachable',
          },
          message:
            'Cannot connect to server. Please check if the server is running and try again.',
        });
      },
    });
    this.sessionId = null;
    this._reacquiring = false;
    this._reacquirePromise = null;
    this._lastTasksWarning = null;
    this._lastTasksWarningAt = 0;
  }
  // Initialize provider and acquire a session. Init should only perform
  // overall initialization; actual session acquisition is factored into
  // `acquireSession` so callers can re-acquire without triggering full
  // client-side reloads that would wipe WIP scenario data.
  async init() {
    await this.acquireSession();
  }

  // Acquire a server session. This method only manages session lifecycle
  // (create/refresh session) and must not perform UI data-loading side
  // effects such as reloading scenarios which could overwrite client WIP.
  async acquireSession() {
    // Attempt to read user email from local storage prefs
    let email = null;
    try {
      const raw = localStorage.getItem('az_planner:user_prefs:v1');
      const prefs = raw ? JSON.parse(raw) : {};
      email = prefs['user.email'] || null;
      console.log('Loaded user email from prefs:', email);
    } catch {
      // If no email was found, don't do anything. The user needs to push the config first.
      return;
    }

    // Create a session via POST /api/session
    try {
      const result = await this._fetchJson('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!result.ok) {
        console.error('Failed to create session', result.error);
        return;
      }
      const data = result.data || {};
      this.sessionId = data.sessionId || null;
      console.log('Created session id:', this.sessionId);
    } catch (err) {
      console.error('Session creation error', err);
    }
  }

  async _handleSessionExpiry() {
    // If already reacquiring, wait for that to complete
    if (this._reacquiring && this._reacquirePromise) {
      return await this._reacquirePromise;
    }

    this._reacquiring = true;
    this._reacquirePromise = (async () => {
      try {
        await this.acquireSession();
        // If acquireSession did not set a session id, treat it as failure.
        if (!this.sessionId) {
          throw new Error('reacquire_failed');
        }
        console.log('Session quietly re-acquired');
        return true;
      } catch (err) {
        console.error('Failed to re-acquire session', err);
        // Only emit error event if reacquisition failed
        bus.emit(SessionEvents.EXPIRED, {
          ok: false,
          error: String(err),
          message:
            'Session could not be reacquired. Please check if the server is up and your PAT is valid.',
        });
        return false;
      } finally {
        this._reacquiring = false;
        this._reacquirePromise = null;
      }
    })();

    return await this._reacquirePromise;
  }

  async _requestJson(url, options = {}) {
    return this._fetchJson(url, {
      ...options,
      headers: this._headers(options.headers),
    });
  }

  _headers(extra) {
    const h = Object.assign({}, extra || {});
    if (this.sessionId) {
      h['X-Session-Id'] = this.sessionId;
    }
    // Signal that we prefer JSON responses from the server
    if (!h['Accept']) h['Accept'] = 'application/json';
    return h;
  }

  async _showTasksWarning(message) {
    const text = String(message || '').trim();
    if (!text) return;
    const now = Date.now();
    if (this._lastTasksWarning === text && now - this._lastTasksWarningAt < 30000) {
      return;
    }
    this._lastTasksWarning = text;
    this._lastTasksWarningAt = now;

    try {
      await import('../components/AutoCloseMessageModal.js');
      let modal = document.getElementById('app-message-modal');
      if (!modal) {
        modal = document.createElement('modal-autoclose');
        modal.id = 'app-message-modal';
        document.body.appendChild(modal);
      }
      modal.message = text;
      modal.duration = 7000;
      modal.open = true;
    } catch (err) {
      console.warn('tasks warning:', text, err);
    }
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
    if (scenario.readonly) {
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

  async renameScenario(id, name) {
    // Persist name by saving the scenario metadata; backend stores raw structure.
    const result = await this._requestJson('/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'save', data: { id, name } }),
    });
    if (!result.ok) return result;

    const listResult = await this.listScenarios();
    if (listResult.ok) {
      bus.emit(DataEvents.SCENARIOS_CHANGED, listResult.data);
    }
    console.log('providerREST:renameScenario:', result.data);
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
      const resTasks = await this._fetch(url, { headers: this._headers() });
      if (!resTasks.ok) {
        return fail({ message: `HTTP ${resTasks.status}`, status: resTasks.status });
      }
      const staleWarning = resTasks.headers && resTasks.headers.get('X-Tasks-Warning-Message');
      if (staleWarning) {
        await this._showTasksWarning(staleWarning);
      }
      const tasks = await resTasks.json();
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

  // Fetch cost data (GET) or request a recalculation with payload (POST)
  async getCost(payload) {
    try {
      // Guard: if caller provided an explicit features list that's empty,
      // avoid calling the backend and return a minimal cost schema.
      if (
        payload &&
        typeof payload === 'object' &&
        Array.isArray(payload.features) &&
        payload.features.length === 0
      ) {
        console.log(
          'providerREST:getCost - empty features payload, skipping backend call'
        );
        return ok({ projects: [], months: [], teams: [] });
      }
      // If no payload provided, GET cached cost for session (or schema when unauthenticated)
      if (!payload) {
        return this._requestJson('/api/cost');
      }

      // If payload is an array, treat as legacy overrides array
      if (Array.isArray(payload)) {
        return this._requestJson('/api/cost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides: payload }),
        });
      }

      // If payload is an object, forward it to the new feature-focused endpoint
      // when it contains a `features` array; otherwise fall back to legacy /api/cost
      if (typeof payload === 'object') {
        const url =
          payload && Array.isArray(payload.features) ? '/api/cost/features' : '/api/cost';
        return this._requestJson(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      // Fallback to GET
      return this._requestJson('/api/cost');
    } catch (err) {
      return fail(err);
    }
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
   * @returns {Promise<Array<{id:string, date:string, title:string, plan_id:string}>>}
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
   * @returns {Promise<Array>}
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
   * @returns {Promise<Array>}
   */
  async listGroups(planId) {
    const qs = planId ? `?plan_id=${encodeURIComponent(planId)}` : '';
    return this._requestJson(`/api/groups${qs}`);
  }

  /**
   * Create a new group.
   * @param {{ plan_id:string, name:string, color?:string, rank?:number }} payload
   * @returns {Promise<object|null>}
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
   * @returns {Promise<object|null>}
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
   * @returns {Promise<boolean>}
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
    * Returns an object: {schema_version, plugins:[...]} or null when unavailable.
    * @returns {Promise<object|null>}
   */
  async getPluginsConfig() {
    const result = await this._requestJson('/api/plugins/config');
    if (!result.ok) return result;
    const j = result.data;
    if (j && typeof j === 'object' && Array.isArray(j.plugins)) {
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
