// Admin-side providerREST for admin UI.
// Uses shared RestProviderBase + Result helpers, while keeping admin endpoints separate.
import { RestProviderBase } from '../../../js/services/RestProviderBase.js';
import { ok, fail } from '../../../js/services/result.js';
import { createAuthRecovery } from '../../../js/services/authRecovery.js';

export class AdminProviderREST extends RestProviderBase {
  constructor({ authentication = null } = {}) {
    const recovery = createAuthRecovery({ authentication });
    // Admin UI uses same-origin credentials (cookie/session managed by server).
    super({
      authentication,
      retry: false,
      session: authentication !== null,
      defaultCredentials: 'same-origin',
      onSessionExpired: recovery.onSessionExpired,
      onCredentialFailure: recovery.onCredentialFailure,
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

  async checkAccess() {
    return this._requestJson('/admin/check');
  }

  async getAreaMappings() {
    return this._getContent('/admin/v1/area-mappings', {});
  }

  async resetAccountAccess(accountId) {
    return this._requestJson(`/api/auth/admin-reset/${accountId}`, { method: 'POST' });
  }

  async saveAreaMappings(mappings) {
    return this._saveContent('/admin/v1/area-mappings', mappings);
  }

  async getProjects() {
    return this._getContent('/admin/v1/projects', null);
  }

  async saveProjects(content, processImports = {}) {
    const result = await this._requestWithBody('/admin/v1/projects', { content, process_imports: processImports });
    if (!result.ok && (result.error.status === 400 || result.error.status === 422)) {
      const validation = result.error.detail;
      return fail({ ...result.error, code: validation.error, message: validation.message });
    }
    return result;
  }

  async refreshPlan(planId) {
    return this._requestJson(`/admin/v1/projects/${encodeURIComponent(planId)}/refresh`, {
      method: 'POST',
    });
  }

  async getAdoProcesses() {
    return this._getContent('/admin/v1/ado-processes');
  }

  async resolveAdoProcess(project) {
    const result = await this._requestWithBody('/admin/v1/ado-processes/resolve', { project });
    if (!result.ok && (result.error.status === 400 || result.error.status === 404)) {
      const validation = result.error.detail;
      return fail({ ...result.error, code: validation.error, message: validation.message });
    }
    return result;
  }

  async refreshAdoProcesses() {
    return this._requestJson('/admin/v1/ado-processes/refresh', { method: 'POST' });
  }

  async saveAdoProcesses(content) {
    const result = await this._saveContent('/admin/v1/ado-processes', content);
    if (!result.ok && result.error.status === 400) {
      const validation = result.error.detail;
      return fail({ ...result.error, code: validation.error, message: validation.message });
    }
    return result;
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

  async getAuthenticationSettings() {
    return this._requestJson('/api/auth/settings', { method: 'GET' });
  }

  async getBrowseConfig() {
    return this._getContent('/admin/v1/browse-config');
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

  async getWorkforce() {
    return this._requestJson('/admin/v1/workforce', { method: 'GET' });
  }

  async validateBackup(data) {
    return this._requestWithBody('/admin/v1/restore/validate', data);
  }

  async exportWorkforce() {
    return this._requestJson('/admin/v1/workforce/export', { method: 'GET' });
  }

  async previewWorkforceImport(source, decisions) {
    return this._requestWithBody('/admin/v1/workforce/import/preview', { source, decisions });
  }

  async importWorkforce(payload) {
    return this._requestWithBody('/admin/v1/workforce/import', payload);
  }

  async saveWorkforce(snapshot) {
    return this._requestWithBody('/admin/v1/workforce', snapshot);
  }

  async reviewWorkforceTeamDeletion(teamId) {
    return this._requestJson(
      `/admin/v1/workforce/teams/${encodeURIComponent(teamId)}/deletion`, { method: 'GET' },
    );
  }

  async deleteWorkforceTeam(teamId, payload) {
    return this._requestWithBody(
      `/admin/v1/workforce/teams/${encodeURIComponent(teamId)}/deletion`, payload,
    );
  }

  async createWorkforceDefinition(kind, payload) {
    return this._requestWithBody(
      `/admin/v1/workforce/definitions/${encodeURIComponent(kind)}`, payload,
    );
  }

  async getUsers() {
    return this._requestJson('/admin/v1/users', { method: 'GET' });
  }

  async createUser(email, permissions, pat = '') {
    const payload = { email, permissions };
    if (pat !== '') payload.pat = pat;
    return this._requestWithBody('/admin/v1/users', payload);
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
    const result = await this._saveContent('/admin/v1/iterations', content);
    if (!result.ok && [400, 409].includes(result.error.status)) {
      return fail({ ...result.error, message: result.error.detail.message });
    }
    return result;
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
      schema_version: 2,
      process_order: [],
      type_tiers: {},
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
