// Admin-side providerREST for admin UI.
// Uses shared RestProviderBase + Result helpers, while keeping admin endpoints separate.
import { RestProviderBase } from '../../../js/services/RestProviderBase.js';
import { ok, fail } from '../../../js/services/result.js';

export class AdminProviderREST extends RestProviderBase {
  constructor() {
    // Admin UI uses same-origin credentials (cookie/session managed by server).
    super({
      retry: false,
      session: false,
      defaultCredentials: 'same-origin',
    });
  }

  async _requestJson(url, options = {}) {
    const next = {
      ...options,
      headers: this._headers(options.headers),
    };
    return this._fetchJson(url, next);
  }

  async _getContent(url, fallback = null) {
    const result = await this._requestJson(url, { method: 'GET' });
    if (!result.ok) return result;
    return ok(result.data && Object.prototype.hasOwnProperty.call(result.data, 'content')
      ? result.data.content
      : fallback);
  }

  async _saveContent(url, content) {
    return this._requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async _requestWithBody(url, body, method = 'POST') {
    return this._requestJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async getAreaMappings() {
    return this._getContent('/admin/v1/area-mappings', {});
  }

  async saveAreaMappings(mappings) {
    return this._saveContent('/admin/v1/area-mappings', mappings);
  }

  async getProjects() {
    return this._getContent('/admin/v1/projects', null);
  }

  async saveProjects(content) {
    return this._saveContent('/admin/v1/projects', content);
  }

  async getSystem() {
    return this._getContent('/admin/v1/system', null);
  }

  async saveSystem(content) {
    return this._saveContent('/admin/v1/system', content);
  }

  async getAdo() {
    return this._getContent('/admin/v1/ado', null);
  }

  async saveAdo(content) {
    return this._saveContent('/admin/v1/ado', content);
  }

  async getEventsConfig() {
    return this._getContent('/admin/v1/events-config', null);
  }

  async saveEventsConfig(content) {
    return this._saveContent('/admin/v1/events-config', content);
  }

  async getGroupsConfig() {
    return this._getContent('/admin/v1/groups-config', null);
  }

  async saveGroupsConfig(content) {
    return this._saveContent('/admin/v1/groups-config', content);
  }

  async getTeams() {
    return this._getContent('/admin/v1/teams', null);
  }

  async saveTeams(content) {
    return this._saveContent('/admin/v1/teams', content);
  }

  async getPeople() {
    return this._getContent('/admin/v1/people', null);
  }

  async savePeople(content) {
    return this._saveContent('/admin/v1/people', content);
  }

  async getPeopleInspect() {
    return this._requestJson('/admin/v1/people/inspect', { method: 'GET' });
  }

  async getCostInspect() {
    return this._requestJson('/admin/v1/cost/inspect', { method: 'GET' });
  }

  async getCost() {
    return this._getContent('/admin/v1/cost', null);
  }

  async saveCost(content) {
    return this._saveContent('/admin/v1/cost', content);
  }

  async getUsers() {
    return this._requestJson('/admin/v1/users', { method: 'GET' });
  }

  async createUser(email, permissions) {
    return this._requestWithBody('/admin/v1/users', { email, permissions });
  }

  async setUserPermissions(accountId, permissions) {
    return this._requestWithBody(
      `/admin/v1/users/${encodeURIComponent(accountId)}/permissions`,
      { permissions },
      'PUT'
    );
  }

  async deleteUser(accountId) {
    return this._requestJson(`/admin/v1/users/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
    });
  }

  async refreshAreaMapping(areaPath) {
    return this._requestWithBody('/admin/v1/area-mapping/refresh', {
      area_path: areaPath,
    });
  }

  async refreshAllAreaMappings() {
    return this._requestJson('/admin/v1/area-mapping/refresh-all', { method: 'POST' });
  }

  async togglePlanEnabled(projectId, areaPath, planId, enabled) {
    return this._requestWithBody('/admin/v1/area-mapping/toggle-plan', {
      project_id: projectId,
      area_path: areaPath,
      plan_id: planId,
      enabled,
    });
  }

  async getSchema(configType) {
    return this._requestJson(`/admin/v1/schema/${configType}`, { method: 'GET' });
  }

  async getIterations() {
    return this._getContent('/admin/v1/iterations', null);
  }

  async saveIterations(content) {
    return this._saveContent('/admin/v1/iterations', content);
  }

  async browseIterations(payload) {
    return this._requestWithBody('/admin/v1/iterations/browse', payload);
  }

  async deleteIterationSet(id) {
    return this._requestJson(`/admin/v1/iterations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async unassociateAllIterations(id) {
    return this._requestWithBody(`/admin/v1/iterations/${encodeURIComponent(id)}/unassociate-all`, {});
  }

  async browseAzureProjects(orgUrl) {
    return this._requestJson(`/api/azure/projects?org_url=${encodeURIComponent(orgUrl || '')}`, {
      method: 'GET',
    });
  }

  async browseAreaPaths(project) {
    return this._requestJson(`/api/azure/area-paths?project=${encodeURIComponent(project)}`, {
      method: 'GET',
    });
  }

  async browseWikis(project, orgUrl) {
    return this._requestJson(
      `/api/azure/wikis?project=${encodeURIComponent(project)}&org_url=${encodeURIComponent(orgUrl || '')}`,
      { method: 'GET' }
    );
  }

  async browseWikiPages(project, wikiId, orgUrl) {
    const url = `/api/azure/wiki-pages?project=${encodeURIComponent(project)}&wiki_id=${encodeURIComponent(wikiId)}&org_url=${encodeURIComponent(orgUrl || '')}`;
    return this._requestJson(url, { method: 'GET' });
  }

  async getWorkItemMetadata(project) {
    return this._requestJson(`/api/azure/work-item-metadata?project=${encodeURIComponent(project)}`, {
      method: 'GET',
    });
  }

  async getAreaPathMetadata(project, areaPath) {
    return this._requestJson(
      `/api/azure/area-path-metadata?project=${encodeURIComponent(project)}&area_path=${encodeURIComponent(areaPath)}`,
      { method: 'GET' }
    );
  }

  /**
   * Prefetch and disk-cache work-item metadata for a list of area paths.
   * Returns metadata keyed by area path each including an 'azure_project' field.
   * Cheap to call repeatedly - the server only contacts Azure on a cache miss.
   * @param {string[]} areaPaths
   * @returns {Promise<{ok: boolean, data?: {results: Record<string, object>}, error?: object}>}
   */
  async prefetchProjectsMetadata(areaPaths) {
    if (!areaPaths || areaPaths.length === 0) {
      return ok({ results: {} });
    }
    const encoded = areaPaths.map(encodeURIComponent).join(',');
    return this._requestJson(`/api/azure/prefetch-projects-metadata?area_paths=${encoded}`, {
      method: 'GET',
    });
  }

  async cleanupCache() {
    return this._requestJson('/admin/v1/cache/cleanup', { method: 'POST' });
  }

  async invalidateCache() {
    return this._requestJson('/admin/v1/cache/invalidate', { method: 'POST' });
  }

  async reloadConfig() {
    return this._requestJson('/admin/v1/reload-config', { method: 'POST' });
  }

  async getBackup() {
    return this._requestJson('/admin/v1/backup', { method: 'GET' });
  }

  async restoreBackup(payload) {
    return this._requestWithBody('/admin/v1/restore', payload);
  }

  async getGlobalSettings() {
    const result = await this._getContent('/admin/v1/global-settings', {
      task_type_hierarchy: [],
      state_display_sequence: [],
    });
    if (!result.ok) return result;
    if (!result.data || typeof result.data !== 'object') {
      return fail({ message: 'Invalid global settings payload' });
    }
    return result;
  }

  async saveGlobalSettings(content) {
    return this._saveContent('/admin/v1/global-settings', content);
  }

  async getPluginsConfig() {
    return this._getContent('/admin/v1/plugins-config', null);
  }

  async savePluginsConfig(content) {
    return this._saveContent('/admin/v1/plugins-config', content);
  }
}

// Export a default instance for simple imports
export const adminProvider = new AdminProviderREST();
