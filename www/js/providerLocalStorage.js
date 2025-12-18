// providerLocalStorage.js
// LocalStorage implementation of the BackendProvider interface

export class ProviderLocalStorage {
    logCall(method, args) {
        // Developer-friendly logging for mock provider calls
        const argList = Array.from(args).map(a => JSON.stringify(a)).join(', ');
        console.log(`[ProviderMock] ${method} called with: ${argList}`);
    }

    async getCapabilities() {
        // Simulate capabilities fetch for localStorage
        this.logCall('getCapabilities', arguments);
        return { scenariosPersisted: true, colorsPersisted: true, batchUpdates: true };
    }

    async deleteScenario(id) {
        this.logCall('deleteScenario', arguments);
        let scenarios = JSON.parse(localStorage.getItem('scenarios') || '[]');
        const idx = scenarios.findIndex(s => s.id === id);
        if (idx >= 0) {
            scenarios.splice(idx, 1);
            localStorage.setItem('scenarios', JSON.stringify(scenarios));
            return { id, deleted: true };
        }
        return { id, deleted: false };
    }
    async renameScenario(id, name) {
        this.logCall('renameScenario', arguments);

        let scenarios = JSON.parse(localStorage.getItem('scenarios') || '[]');
        const idx = scenarios.findIndex(s => s.id === id);
        if (idx >= 0) {
            scenarios[idx].name = name;
            localStorage.setItem('scenarios', JSON.stringify(scenarios));
            return scenarios[idx];
        }
        return null;
    }
    async listScenarios() {
        this.logCall('listScenarios', arguments);
        // List scenarios from localStorage
        const scenarios = JSON.parse(localStorage.getItem('scenarios') || '[]');
        return scenarios;
    }

    async publishBaseline(selectedOverrides) {
        this.logCall('publishBaseline', arguments);
        // Simulate annotation of selected overrides in localStorage
        return { ok: true, annotatedAt: new Date().toISOString(), count: selectedOverrides.length };
    }
    async saveScenario(scenario) {
        this.logCall('saveScenario', arguments);
        // Save scenario to localStorage
        let scenarios = JSON.parse(localStorage.getItem('scenarios') || '[]');
        const idx = scenarios.findIndex(s => s.id === scenario.id);
        if (idx >= 0) {
            scenarios[idx] = scenario;
        } else {
            scenarios.push(scenario);
        }
        localStorage.setItem('scenarios', JSON.stringify(scenarios));
        return { ...scenario, savedAt: new Date().toISOString() };
    }
    async checkHealth() {
        this.logCall('checkHealth', arguments);
        // Simulate health check for localStorage
        return { ok: true };
    }
    async setFeatureField(id, field, value) {
        this.logCall('setFeatureField', arguments);
        let features = JSON.parse(localStorage.getItem('features') || '[]');
        const idx = features.findIndex(f => f.id === id);
        if (idx >= 0) {
            features[idx][field] = value;
            localStorage.setItem('features', JSON.stringify(features));
            return features[idx];
        }
        return null;
    }
    async batchSetFeatureDates(updates) {
        this.logCall('batchSetFeatureDates', arguments);
        let features = JSON.parse(localStorage.getItem('features') || '[]');
        const results = [];
        for (const u of updates) {
            const idx = features.findIndex(f => f.id === u.id);
            if (idx >= 0) {
                features[idx].start = u.start;
                features[idx].end = u.end;
                results.push(features[idx]);
            }
        }
        localStorage.setItem('features', JSON.stringify(features));
        return results;
    }
    async setFeatureDates(id, start, end) {
        this.logCall('setFeatureDates', arguments);
        // Update feature dates in localStorage
        let features = JSON.parse(localStorage.getItem('features') || '[]');
        const idx = features.findIndex(f => f.id === id);
        if (idx >= 0) {
            features[idx].start = start;
            features[idx].end = end;
            localStorage.setItem('features', JSON.stringify(features));
            return features[idx];
        }
        return null;
    }

    async getConfig() {
        this.logCall('getConfig', arguments);
        // Fetch config from localStorage
        const config = JSON.parse(localStorage.getItem('config') || '{}');
        return config;
    }

    async getFeatures() {
        this.logCall('getFeatures', arguments);
        // Fetch features from localStorage
        const features = JSON.parse(localStorage.getItem('features') || '[]');
        return features;
    }

    async getTeams() {
        this.logCall('getTeams', arguments);
        // Fetch teams from localStorage
        const teams = JSON.parse(localStorage.getItem('teams') || '[]');
        return teams;
    }

    async getProjects() {
        this.logCall('getProjects', arguments);
        // Fetch projects from localStorage
        const projects = JSON.parse(localStorage.getItem('projects') || '[]');
        return projects;
    }
    // --- Color and Preference Management ---
    async loadColors() {
        this.logCall('loadColors', arguments);
        const raw = localStorage.getItem('az_planner:user_prefs:v1');
        let data;
        try {
            data = raw ? JSON.parse(raw) : { projectColors: {}, teamColors: {} };
        } catch {
            data = { projectColors: {}, teamColors: {} };
        }
        this.logCall('loadColors result', [data]);
        return { projectColors: data.projectColors || {}, teamColors: data.teamColors || {} };
    }

    async saveProjectColor(id, color) {
        this.logCall('saveProjectColor', arguments);
        const raw = localStorage.getItem('az_planner:user_prefs:v1');
        let data;
        try {
            data = raw ? JSON.parse(raw) : { projectColors: {}, teamColors: {} };
        } catch {
            data = { projectColors: {}, teamColors: {} };
        }
        data.projectColors = data.projectColors || {};
        data.projectColors[id] = color;
        try {
            localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify(data));
        } catch {}
    }

    async saveTeamColor(id, color) {
        this.logCall('saveTeamColor', arguments);
        const raw = localStorage.getItem('az_planner:user_prefs:v1');
        let data;
        try {
            data = raw ? JSON.parse(raw) : { projectColors: {}, teamColors: {} };
        } catch {
            data = { projectColors: {}, teamColors: {} };
        }
        data.teamColors = data.teamColors || {};
        data.teamColors[id] = color;
        try {
            localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify(data));
        } catch {}
    }

    async clearAll() {
        this.logCall('clearAll', arguments);
        try {
            localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify({ projectColors: {}, teamColors: {} }));
        } catch {}
    }

    async getLocalPref(key) {
        this.logCall('getLocalPref', arguments);
        const raw = localStorage.getItem('az_planner:user_prefs:v1');
        let data;
        try {
            data = raw ? JSON.parse(raw) : { projectColors: {}, teamColors: {} };
        } catch {
            data = { projectColors: {}, teamColors: {} };
        }
        return data[key];
    }

    async setLocalPref(key, value) {
        this.logCall('setLocalPref', arguments);
        const raw = localStorage.getItem('az_planner:user_prefs:v1');
        let data;
        try {
            data = raw ? JSON.parse(raw) : { projectColors: {}, teamColors: {} };
        } catch {
            data = { projectColors: {}, teamColors: {} };
        }
        data[key] = value;
        try {
            localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify(data));
        } catch {}
    }
    // --- End Color and Preference Management ---
}
