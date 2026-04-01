// providerREST.js
// REST API implementation of the BackendProvider interface (stub)
import { bus } from '../core/EventBus.js';
import { DataEvents, SessionEvents } from '../core/EventRegistry.js';

export class ProviderREST {
  constructor() {
    this.sessionId = null;
    this._reacquiring = false;
    this._reacquirePromise = null;
    this._networkRetryCount = 2; // Number of retries for network errors
    this._networkRetryDelay = 1000; // Delay between retries in ms
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
      const res = await this._fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res && res.sessionExpired) {
        console.error(
          'Session creation failed: server indicated expired/invalid session',
          res.detail
        );
      } else if (res.ok) {
        const data = await res.json();
        this.sessionId = data.sessionId;
        console.log('Created session id:', this.sessionId);
      } else {
        console.error('Failed to create session', res.status);
      }
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

  // Centralized fetch wrapper that detects session expiry (401 + invalid_session) and network errors
  async _fetch(url, opts, _retryCount = 0) {
    if (url.startsWith('/')) {
      url = (window.APP_BASE_URL || '') + url;
    }
    try {
      opts = opts || {};
      opts.headers = opts.headers || {};
      if (!opts.headers['Accept']) opts.headers['Accept'] = 'application/json';
      const res = await fetch(url, opts);
      //console.log('[providerREST._fetch, 103] fetched', url, 'status=', res && res.status, 'ok=', res && res.ok, res);
      if (res.status === 401) {
        // Try to parse JSON body for error detail
        let body = null;
        try {
          body = await res.json();
        } catch (e) {
          body = null;
        }
        const errCode = body && body.error ? body.error : null;
        if (errCode === 'invalid_session' || errCode === 'missing_session_id') {
          // Attempt to quietly reacquire session
          const reacquired = await this._handleSessionExpiry();

          if (reacquired) {
            // Session reacquired successfully - retry the request
            // Update headers with new session ID if present
            if (this.sessionId) {
              opts.headers['X-Session-Id'] = this.sessionId;
            }
            return await fetch(url, opts);
          } else {
            // Reacquisition failed - return error
            return { sessionExpired: true, status: res.status, detail: body };
          }
        }
        return res;
      }
      return res;
    } catch (err) {
      // Network error (server unreachable, timeout, etc.)
      if (_retryCount < this._networkRetryCount) {
        // Quietly retry with exponential backoff
        const delay = this._networkRetryDelay * Math.pow(2, _retryCount);
        console.log(
          `Network error, retrying in ${delay}ms (attempt ${_retryCount + 1}/${this._networkRetryCount})...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return await this._fetch(url, opts, _retryCount + 1);
      } else {
        // All retries exhausted - emit error event and throw
        console.error('Network error after retries exhausted:', err);
        bus.emit(SessionEvents.EXPIRED, {
          ok: false,
          error: String(err),
          message:
            'Cannot connect to server. Please check if the server is running and try again.',
        });
        throw err;
      }
    }
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

  async getCapabilities() {
    // Example: fetch capabilities via REST API (stub)
    // return fetch('/api/capabilities').then(res => res.json());
    return {
      scenariosPersisted: true,
      colorsPersisted: true,
      batchUpdates: true,
    };
  }

  async listScenarios() {
    try {
      const res = await this._fetch('/api/scenario', {
        headers: this._headers(),
      });
      if (res && res.sessionExpired) return [];
      if (!res.ok) return [];
      const list = await res.json();
      bus.emit(DataEvents.SCENARIOS_CHANGED, list);
      console.log('providerREST:listScenarios:', list);
      return list;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async loadAllScenarios() {
    const metas = await this.listScenarios();
    const scenarios = [];
    for (const m of metas) {
      // Load all scenarios from server (server should not send baseline, but we can handle it)
      if (!m || !m.id) continue;
      const data = await this.getScenario(m.id);
      if (data) {
        scenarios.push(data);
      }
    }
    bus.emit(DataEvents.SCENARIOS_DATA, scenarios);
    console.log('providerREST:loadAllScenarios - Fetched scenarios:', scenarios);
    return scenarios;
  }

  async getScenario(id) {
    try {
      const res = await this._fetch(`/api/scenario?id=${encodeURIComponent(id)}`, {
        headers: this._headers(),
      });
      if (res && res.sessionExpired) return null;
      if (!res.ok) return null;
      const data = await res.json();
      console.log('providerREST:getScenario - Fetched scenario:', data);
      return data;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async saveScenario(scenario) {
    // Client-side guard: Don't attempt to save readonly scenarios
    if (scenario.readonly) {
      console.warn('[providerREST] Attempted to save readonly scenario:', scenario.id);
      return { ok: false, error: 'Cannot save readonly scenario' };
    }

    try {
      const body = JSON.stringify({ op: 'save', data: scenario });
      const res = await this._fetch('/api/scenario', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body,
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const meta = await res.json();
      const list = await this.listScenarios();
      bus.emit(DataEvents.SCENARIOS_CHANGED, list);
      console.log('providerREST:saveScenario:', meta);
      return meta;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async renameScenario(id, name) {
    // Persist name by saving the scenario metadata; backend stores raw structure.
    try {
      const body = JSON.stringify({ op: 'save', data: { id, name } });
      const res = await this._fetch('/api/scenario', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body,
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const meta = await res.json();
      const list = await this.listScenarios();
      bus.emit(DataEvents.SCENARIOS_CHANGED, list);
      console.log('providerREST:renameScenario:', meta);
      return meta;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async deleteScenario(id) {
    try {
      const body = JSON.stringify({ op: 'delete', data: { id } });
      const res = await this._fetch('/api/scenario', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body,
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const ok = !!data?.ok;
      if (ok) {
        const list = await this.listScenarios();
        bus.emit(DataEvents.SCENARIOS_CHANGED, list);
      }
      console.log('providerREST:deleteScenario:', data);
      return ok;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async publishBaseline(selectedOverrides) {
    try {
      const res = await this._fetch('/api/tasks', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(selectedOverrides),
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async updateTasksWithCapacity(updates) {
    // Send task updates with optional capacity data to /api/tasks
    // Expected format: [{ id, start?, end?, capacity?: [{team, capacity}] }]
    try {
      const res = await this._fetch('/api/tasks', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updates),
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async updateWorkItemCapacity(workItemId, capacity) {
    // Update capacity for a specific work item
    // Expected format: capacity is [{team: 'team-id', capacity: number}]
    try {
      const res = await this._fetch(`/api/tasks/${workItemId}/capacity`, {
        method: 'PUT',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(capacity),
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) {
        const errorText = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${errorText}` };
      }
      return await res.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async saveConfig(config) {
    try {
      const res = await this._fetch('/api/account', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(config),
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      return await res.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async checkHealth() {
    // Perform an actual fetch to /api/health and return parsed JSON.
    try {
      const res = await this._fetch('/api/health');
      if (res && res.sessionExpired) return { status: 'error', error: 'session_expired' };
      if (!res.ok) return { status: 'error' };
      return await res.json();
    } catch (err) {
      return { status: 'error', error: String(err) };
    }
  }

  async getConfig() {
    // Example: fetch config from REST API (stub)
    // return fetch('/api/account').then(res => res.json());
    return {};
  }

  async getFeatures(project) {
    const url =
      project ? `/api/tasks?project=${encodeURIComponent(project)}` : '/api/tasks';
    const resTasks = await this._fetch(url, { headers: this._headers() });
    if (resTasks && resTasks.sessionExpired) return [];
    if (!resTasks.ok) return [];
    const tasks = await resTasks.json();
    // Calculate derived fields used in the frontend
    // - parentEpic is used for relating Features to their parent Epic
    function getParent(f) {
      const parentRel = f.relations.find((r) => r.type === 'Parent');
      return parentRel ? parentRel.id : null;
    }
    //const parentEpic = tasks.relations ? tasks.relations.find(r => r.type === 'Parent') : null;
    //console.log("Parent Epic:", parentEpic);
    const retval = (tasks || []).map((f) => ({
      ...f,
      parentEpic: getParent(f),
      original: { ...f },
      changedFields: [],
      dirty: false,
    }));
    //console.log('providerREST:getFeatures - Fetched tasks:', retval);
    return retval;
  }

  async getTeams() {
    try {
      const res = await this._fetch('/api/teams', { headers: this._headers() });
      if (res && res.sessionExpired) return [];
      if (!res.ok) return [];
      let retval = await res.json();
      // TODO: move item selection state to scenario configuration
      retval = retval.map((team) => ({ ...team, selected: true }));
      //console.log('providerREST:getTeams - Fetched teams:', retval);
      return retval;
    } catch (err) {
      console.error('providerREST:getTeams error', err);
      return {};
    }
  }

  async getProjects() {
    try {
      const res = await this._fetch('/api/projects', {
        headers: this._headers(),
      });
      if (res && res.sessionExpired) return [];
      if (!res.ok) return [];
      let retval = await res.json();
      // TODO: move item selection state to scenario configuration
      retval = retval.map((project) => ({ ...project, selected: true }));
      console.log('providerREST:getProjects - Fetched projects:', retval);
      return retval;
    } catch (err) {
      console.error('providerREST:getProjects error', err);
      return {};
    }
  }

  async getIterations(project) {
    try {
      const url =
        project ?
          `/api/iterations?project=${encodeURIComponent(project)}`
        : '/api/iterations';
      const res = await this._fetch(url, { headers: this._headers() });
      if (res && res.sessionExpired) return [];
      if (!res.ok) return [];
      const data = await res.json();
      return data.iterations || [];
    } catch (err) {
      console.error('providerREST:getIterations', err);
      return [];
    }
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
        return { projects: [], months: [], teams: [] };
      }
      // If no payload provided, GET cached cost for session (or schema when unauthenticated)
      if (!payload) {
        const res = await this._fetch('/api/cost', {
          headers: this._headers(),
        });
        if (res && res.sessionExpired)
          throw Object.assign(new Error('session_expired'), {
            sessionExpired: true,
          });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      }

      // If payload is an array, treat as legacy overrides array
      if (Array.isArray(payload)) {
        const res = await this._fetch('/api/cost', {
          method: 'POST',
          headers: this._headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ overrides: payload }),
        });
        if (res && res.sessionExpired)
          throw Object.assign(new Error('session_expired'), {
            sessionExpired: true,
          });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      }

      // If payload is an object, forward it to the new feature-focused endpoint
      // when it contains a `features` array; otherwise fall back to legacy /api/cost
      if (typeof payload === 'object') {
        const url =
          payload && Array.isArray(payload.features) ? '/api/cost/features' : '/api/cost';
        const res = await this._fetch(url, {
          method: 'POST',
          headers: this._headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
        if (res && res.sessionExpired)
          throw Object.assign(new Error('session_expired'), {
            sessionExpired: true,
          });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      }

      // Fallback to GET
      const res = await this._fetch('/api/cost', { headers: this._headers() });
      if (res && res.sessionExpired)
        throw Object.assign(new Error('session_expired'), {
          sessionExpired: true,
        });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('providerREST:getCost error', err);
      throw err;
    }
  }

  async getCostTeams() {
    try {
      const res = await this._fetch('/api/cost/teams', {
        headers: this._headers(),
      });
      if (res && res.sessionExpired) return [];
      if (!res.ok) return [];
      const data = await res.json();
      console.log('providerREST:getCostTeams - Fetched cost teams', data);
      return data;
    } catch (err) {
      console.error('providerREST:getCostTeams error', err);
      return [];
    }
  }

  async getMarkers() {
    try {
      const res = await this._fetch('/api/markers', {
        headers: this._headers(),
      });
      if (res && res.sessionExpired) return [];
      if (!res.ok) return [];
      const data = await res.json();
      console.log('providerREST:getMarkers - Fetched markers', data);
      return data;
    } catch (err) {
      console.error('providerREST:getMarkers error', err);
      return [];
    }
  }

  /**
   * Fetch history entries for a given project.
   * @param {string} projectId
   * @param {{per_page?:number, invalidate_cache?:boolean}} [opts]
   */
  async getHistory(projectId, opts) {
    try {
      const perPage = opts && opts.per_page ? opts.per_page : 500;
      const invalidate = opts && opts.invalidate_cache ? '&invalidate_cache=true' : '';
      const url = `/api/history/tasks?project=${encodeURIComponent(projectId)}&per_page=${perPage}${invalidate}`;
      const res = await this._fetch(url, { headers: this._headers() });
      if (res && res.sessionExpired) return { tasks: [], sessionExpired: true };
      if (!res.ok) {
        console.warn('providerREST:getHistory failed', res.status);
        return { tasks: [] };
      }
      const data = await res.json();
      return data || { tasks: [] };
    } catch (err) {
      console.error('providerREST:getHistory error', err);
      return { tasks: [] };
    }
  }

  async invalidateCache() {
    try {
      const res = await this._fetch('/api/cache/invalidate', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log('providerREST:invalidateCache - Cache invalidated', data);
      return data;
    } catch (err) {
      console.error('providerREST:invalidateCache error', err);
      return { ok: false, error: String(err) };
    }
  }

  // ========== View Management ==========

  async listViews() {
    try {
      const res = await this._fetch('/api/view', {
        method: 'GET',
        headers: this._headers(),
      });
      if (res && res.sessionExpired) return [];
      if (!res.ok) {
        return [];
      }
      return await res.json();
    } catch (err) {
      return [];
    }
  }

  async getView(id) {
    try {
      const res = await this._fetch(`/api/view?id=${id}`, {
        method: 'GET',
        headers: this._headers(),
      });
      if (res && res.sessionExpired) return null;
      if (!res.ok) {
        return null;
      }
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  async saveView(view) {
    try {
      const body = JSON.stringify({ op: 'save', data: view });
      const res = await this._fetch('/api/view', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body,
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const meta = await res.json();
      console.log('providerREST:saveView - Saved view:', meta);
      return meta;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async renameView(id, name) {
    try {
      // Load existing view, update name, save back
      const view = await this.getView(id);
      if (!view) return { ok: false, error: 'View not found' };
      view.name = name;
      const body = JSON.stringify({ op: 'save', data: view });
      const res = await this._fetch('/api/view', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body,
      });
      if (res && res.sessionExpired) return { ok: false, error: 'session_expired' };
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const meta = await res.json();
      console.log('providerREST:renameView - Renamed view:', meta);
      return meta;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async deleteView(id) {
    try {
      const body = JSON.stringify({ op: 'delete', data: { id } });
      const res = await this._fetch('/api/view', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body,
      });
      if (res && res.sessionExpired) return false;
      if (!res.ok) {
        return false;
      }
      const data = await res.json();
      const ok = !!data?.ok;
      console.log('providerREST:deleteView - Deleted view:', data);
      return ok;
    } catch (err) {
      return false;
    }
  }
}
