// Admin-side providerREST for admin UI. Mirrors user `providerREST` helpers
// but keeps admin API calls separate and scoped to the admin frontend.
export class AdminProviderREST {
  constructor() {
    // Admin UI uses same-origin credentials (cookie/session managed by server)
  }

  _headers(extra) {
    return Object.assign({}, extra || {});
  }

  async _fetch(url, options) {
    if (url.startsWith('/')) {
      url = (window.APP_BASE_URL || '') + url;
    }
    return fetch(url, options);
  }

  _logError(method, url, err) {
    console.error(`AdminProviderREST:${method} ${url}`, err);
  }

  _httpError(res) {
    return { ok: false, error: `HTTP ${res.status}` };
  }

  async _getJson(url, methodName, fallback = null) {
    try {
      const res = await this._fetch(url, { method: 'GET', credentials: 'same-origin' });
      if (!res.ok) return fallback;
      return await res.json();
    } catch (err) {
      this._logError(methodName, url, err);
      return fallback;
    }
  }

  async _getContent(url, methodName, fallback = null) {
    const j = await this._getJson(url, methodName, null);
    if (!j || j.content == null) return fallback;
    return j.content;
  }

  async _postJson(url, methodName, payload = undefined, fallback = null) {
    const options = {
      method: 'POST',
      credentials: 'same-origin',
    };
    if (payload !== undefined) {
      options.headers = this._headers({ 'Content-Type': 'application/json' });
      options.body = JSON.stringify(payload);
    }
    try {
      const res = await this._fetch(url, options);
      if (!res.ok) {
        return fallback || this._httpError(res);
      }
      return await res.json();
    } catch (err) {
      this._logError(methodName, url, err);
      return fallback || { ok: false, error: String(err) };
    }
  }

  _adminGet(path, methodName, fallback = null) {
    return this._getContent(path, methodName, fallback);
  }

  _adminSave(path, methodName, content) {
    return this._postJson(path, methodName, { content });
  }

  _azureGet(path, methodName, fallback) {
    return this._getJson(path, methodName, fallback);
  }

  async getAreaMappings() {
    return this._adminGet('/admin/v1/area-mappings', 'getAreaMappings', {});
  }

  async saveAreaMappings(mappings) {
    return this._adminSave('/admin/v1/area-mappings', 'saveAreaMappings', mappings);
  }

  // --- Projects/System/Teams/Users helpers ---
  async getProjects() {
    return this._adminGet('/admin/v1/projects', 'getProjects');
  }

  async saveProjects(content) {
    return this._adminSave('/admin/v1/projects', 'saveProjects', content);
  }

  async getSystem() {
    return this._adminGet('/admin/v1/system', 'getSystem');
  }

  async saveSystem(content) {
    return this._adminSave('/admin/v1/system', 'saveSystem', content);
  }

  async getAdo() {
    return this._adminGet('/admin/v1/ado', 'getAdo');
  }

  async saveAdo(content) {
    return this._adminSave('/admin/v1/ado', 'saveAdo', content);
  }

  async getEventsConfig() {
    return this._adminGet('/admin/v1/events-config', 'getEventsConfig');
  }

  async saveEventsConfig(content) {
    return this._adminSave('/admin/v1/events-config', 'saveEventsConfig', content);
  }

  async getGroupsConfig() {
    return this._adminGet('/admin/v1/groups-config', 'getGroupsConfig');
  }

  async saveGroupsConfig(content) {
    return this._adminSave('/admin/v1/groups-config', 'saveGroupsConfig', content);
  }

  async getTeams() {
    return this._adminGet('/admin/v1/teams', 'getTeams');
  }

  async saveTeams(content) {
    return this._adminSave('/admin/v1/teams', 'saveTeams', content);
  }

  async getPeople() {
    return this._adminGet('/admin/v1/people', 'getPeople');
  }

  async savePeople(content) {
    return this._adminSave('/admin/v1/people', 'savePeople', content);
  }

  async getPeopleInspect() {
    return this._getJson('/admin/v1/people/inspect', 'getPeopleInspect');
  }

  async getCostInspect() {
    return this._getJson('/admin/v1/cost/inspect', 'getCostInspect');
  }

  async getCost() {
    return this._adminGet('/admin/v1/cost', 'getCost');
  }

  async saveCost(content) {
    return this._adminSave('/admin/v1/cost', 'saveCost', content);
  }

  async getUsers() {
    return this._getJson('/admin/v1/users', 'getUsers');
  }

  async saveUsers(payload) {
    return this._postJson('/admin/v1/users', 'saveUsers', payload);
  }

  async refreshAreaMapping(areaPath) {
    return this._postJson('/admin/v1/area-mapping/refresh', 'refreshAreaMapping', {
      area_path: areaPath,
    });
  }

  async refreshAllAreaMappings() {
    return this._postJson('/admin/v1/area-mapping/refresh-all', 'refreshAllAreaMappings');
  }

  async togglePlanEnabled(projectId, areaPath, planId, enabled) {
    return this._postJson('/admin/v1/area-mapping/toggle-plan', 'togglePlanEnabled', {
      project_id: projectId,
      area_path: areaPath,
      plan_id: planId,
      enabled,
    });
  }

  async getSchema(configType) {
    return this._getJson(`/admin/v1/schema/${configType}`, 'getSchema');
  }

  async getIterations() {
    return this._getJson('/admin/v1/iterations', 'getIterations', {
      content: {},
      validation: { errors: [], warnings: [] },
    });
  }

  async saveIterations(content) {
    return this._adminSave('/admin/v1/iterations', 'saveIterations', content);
  }

  async browseIterations(payload) {
    return this._postJson('/admin/v1/iterations/browse', 'browseIterations', payload, {
      iterations: [],
    });
  }

  async previewIterationsResolution(payload) {
    return this._postJson(
      '/admin/v1/iterations/resolve-preview',
      'previewIterationsResolution',
      payload,
      {
        ok: false,
        projects: [],
        summary: { projectCount: 0, totalIterations: 0, fetchErrors: 0, fetchAttempted: false },
      }
    );
  }

  async migrateIterations(payload) {
    return this._postJson('/admin/v1/iterations/migrate', 'migrateIterations', payload, {
      ok: false,
      dry_run: true,
      content: {},
      validation: { errors: [], warnings: [] },
    });
  }

  // --- Azure browse helpers (require PAT in session) ---

  async browseAzureProjects(orgUrl) {
    return this._azureGet(
      `/api/azure/projects?org_url=${encodeURIComponent(orgUrl || '')}`,
      'browseAzureProjects',
      { projects: [], error: 'request_failed' }
    );
  }

  async browseAreaPaths(project) {
    return this._azureGet(`/api/azure/area-paths?project=${encodeURIComponent(project)}`, 'browseAreaPaths', {
      area_paths: [],
      error: 'request_failed',
    });
  }

  async browseWikis(project, orgUrl) {
    const url = `/api/azure/wikis?project=${encodeURIComponent(project)}&org_url=${encodeURIComponent(orgUrl || '')}`;
    return this._azureGet(url, 'browseWikis', { wikis: [], error: 'request_failed' });
  }

  async browseWikiPages(project, wikiId, orgUrl) {
    const url = `/api/azure/wiki-pages?project=${encodeURIComponent(project)}&wiki_id=${encodeURIComponent(wikiId)}&org_url=${encodeURIComponent(orgUrl || '')}`;
    return this._azureGet(url, 'browseWikiPages', { pages: [], error: 'request_failed' });
  }

  async getWorkItemMetadata(project) {
    const url = `/api/azure/work-item-metadata?project=${encodeURIComponent(project)}`;
    return this._azureGet(url, 'getWorkItemMetadata', {
      types: [],
      states: [],
      states_by_type: {},
      state_categories: {},
      error: 'request_failed',
    });
  }

  async getAreaPathMetadata(project, areaPath) {
    const url = `/api/azure/area-path-metadata?project=${encodeURIComponent(project)}&area_path=${encodeURIComponent(areaPath)}`;
    return this._azureGet(url, 'getAreaPathMetadata', {
      types: [],
      states: [],
      states_by_type: {},
      state_categories: {},
      error: 'request_failed',
    });
  }

  /**
   * Prefetch and disk-cache work-item metadata for a list of area paths.
   * Returns metadata keyed by area path each including an 'azure_project' field.
   * Cheap to call repeatedly — the server only contacts Azure on a cache miss.
   * @param {string[]} areaPaths
   * @returns {Promise<{results: Record<string, object>}>}
   */
  async prefetchProjectsMetadata(areaPaths) {
    if (!areaPaths || areaPaths.length === 0) return { results: {} };
    const encoded = areaPaths.map(encodeURIComponent).join(',');
    return this._azureGet(
      `/api/azure/prefetch-projects-metadata?area_paths=${encoded}`,
      'prefetchProjectsMetadata',
      { results: {}, error: 'request_failed' }
    );
  }

  async cleanupCache() {
    return this._postJson('/admin/v1/cache/cleanup', 'cleanupCache');
  }

  async invalidateCache() {
    return this._postJson('/admin/v1/cache/invalidate', 'invalidateCache');
  }

  async reloadConfig() {
    return this._postJson('/admin/v1/reload-config', 'reloadConfig');
  }

  async getBackup() {
    return this._getJson('/admin/v1/backup', 'getBackup');
  }

  async restoreBackup(payload) {
    return this._postJson('/admin/v1/restore', 'restoreBackup', payload);
  }

  async getGlobalSettings() {
    return this._adminGet('/admin/v1/global-settings', 'getGlobalSettings', {
      task_type_hierarchy: [],
      state_display_sequence: [],
    });
  }

  async saveGlobalSettings(content) {
    return this._adminSave('/admin/v1/global-settings', 'saveGlobalSettings', content);
  }

  async getPluginsConfig() {
    return this._adminGet('/admin/v1/plugins-config', 'getPluginsConfig');
  }

  async savePluginsConfig(content) {
    return this._adminSave('/admin/v1/plugins-config', 'savePluginsConfig', content);
  }


}

// Export a default instance for simple imports
export const adminProvider = new AdminProviderREST();
