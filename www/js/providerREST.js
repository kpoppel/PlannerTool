// providerREST.js
// REST API implementation of the BackendProvider interface (stub)

export class ProviderREST {
    async getCapabilities() {
        // Example: fetch capabilities via REST API (stub)
        // return fetch('/api/capabilities').then(res => res.json());
        return { scenariosPersisted: true, colorsPersisted: true, batchUpdates: true };
    }
    // async persistScenarioOverrides(id, overrides) {
    // [Offline mode] This function can be expanded to persist scenario updates in localStorage for draft/offline scenarios.
    // Currently disabled for code simplification. See issue #offline-mode.
    // Example: persist scenario overrides via REST API (stub)
    // return fetch(`/api/scenarios/${id}/overrides`, { method: 'POST', body: JSON.stringify({ overrides }) }).then(res => res.json());
    //    return { id, overrides, persistedAt: new Date().toISOString() };
    // }
    async deleteScenario(id) {
        // Example: delete scenario via REST API (stub)
        // return fetch(`/api/scenarios/${id}`, { method: 'DELETE' }).then(res => res.json());
        return { id, deleted: true };
    }
    async renameScenario(id, name) {
        // Example: rename scenario via REST API (stub)
        // return fetch(`/api/scenarios/${id}/rename`, { method: 'POST', body: JSON.stringify({ name }) }).then(res => res.json());
        return { id, name };
    }
    async listScenarios() {
        // Example: list scenarios via REST API (stub)
        // return fetch('/api/scenarios').then(res => res.json());
        return [];
    }
    async setPat(patInput) {
        // Example: submit PAT via REST API (stub)
        // return fetch('/api/pat', { method: 'POST', body: JSON.stringify({ pat: patInput }) }).then(res => res.json());
        return { token: 'PAT-STORE-MOCKED' };
    }
    async publishBaseline(selectedOverrides, scenario) {
        // Example: annotate selected overrides via REST API (stub)
        // return fetch('/api/scenarios/annotate', { method: 'POST', body: JSON.stringify({ selectedOverrides, scenario }) }).then(res => res.json());
        return { ok: true, annotatedAt: new Date().toISOString(), count: selectedOverrides.length };
    }
    async refreshBaseline() {
        // Example: refresh baseline via REST API (stub)
        // return fetch('/api/baseline/refresh').then(res => res.json());
        return { ok: true, refreshedAt: new Date().toISOString() };
    }
    async syncScenario(scenario) {
        // Example: sync scenario via REST API (stub)
        // return fetch('/api/scenarios/sync', { method: 'POST', body: JSON.stringify(scenario) }).then(res => res.json());
        return { ok: true, syncedAt: new Date().toISOString(), updatedFeatureCount: Object.keys(scenario.overrides || {}).length };
    }
    async saveScenario(scenario) {
        // Example: save scenario via REST API (stub)
        // return fetch('/api/scenarios', { method: 'POST', body: JSON.stringify(scenario) }).then(res => res.json());
        return { ...scenario, savedAt: new Date().toISOString() };
    }
    async checkHealth() {
        // Example: health check via REST API (stub)
        // return fetch('/api/health').then(res => res.json());
        return { ok: true };
    }
    async setFeatureField(id, field, value) {
        // Example: update feature field via REST API (stub)
        // return fetch(`/api/features/${id}/field`, { method: 'POST', body: JSON.stringify({ field, value }) }).then(res => res.json());
        return { id, [field]: value };
    }
    async batchSetFeatureDates(updates) {
        // Example: batch update via REST API (stub)
        // return fetch('/api/features/batchUpdate', { method: 'POST', body: JSON.stringify(updates) }).then(res => res.json());
        return updates.map(u => ({ id: u.id, start: u.start, end: u.end }));
    }
    async setFeatureDates(id, start, end) {
        // Example: update feature dates via REST API (stub)
        // return fetch(`/api/features/${id}/dates`, { method: 'POST', body: JSON.stringify({ start, end }) }).then(res => res.json());
        return { id, start, end };
    }
    async getConfig() {
        // Example: fetch config from REST API (stub)
        // return fetch('/api/config').then(res => res.json());
        return {};
    }
    async getAll() {
        return {
        projects: await this.getProjects(),
        teams: await this.getTeams(),
        features: await this.getFeatures()
        };
    }
    async getFeatures() {
        // Example: fetch features from REST API (stub)
        // return fetch('/api/features').then(res => res.json());
        return [];
    }
    async getTeams() {
        // Example: fetch teams from REST API (stub)
        // return fetch('/api/teams').then(res => res.json());
        return [];
    }
    async getProjects() {
        // Example: fetch projects from REST API (stub)
        // return fetch('/api/projects').then(res => res.json());
        return [];
    }
  // ...other methods will be added in later steps
}
