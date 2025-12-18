// providerMock.js
// Mock implementation of the BackendProvider interface

export class ProviderMock {
    constructor() {
        this.projects = [
            { id:'alpha', name:'Project Alpha', selected:true },
            { id:'beta', name:'Project Beta', selected:true },
            { id:'ceta', name:'Project Ceta', selected:true }
        ];
        this.teams = [
            { id:'frontend', name:'Frontend Team', selected:true },
            { id:'backend', name:'Backend Team', selected:true },
            { id:'devops', name:'DevOps Team', selected:true }
        ];
        this.features = [
            { id:'epic-alpha-1', type:'epic', title:'Alpha Platform Expansion', project:'alpha', start:'2025-01-01', end:'2025-06-30', capacity:[{team:'frontend', capacity:18},{team:'backend', capacity:22}], status:'In Progress', assignee:'Alice', description:'High-level expansion of Alpha platform.', azureUrl:'#' },
            { id:'epic-beta-1', type:'epic', title:'Beta Reliability Initiative', project:'beta', start:'2025-02-01', end:'2025-09-30', capacity:[{team:'backend', capacity:15},{team:'devops', capacity:20}], status:'New', assignee:'Bob', description:'Improve reliability & observability.', azureUrl:'#' },
            { id:'epic-ceta-1', type:'epic', title:'Ceta Backend Implementation', project:'ceta', start:'2025-03-20', end:'2025-06-14', capacity:[{team:'backend', capacity:50},{team:'devops', capacity:10}], status:'New', assignee:'John', description:'Implement the backend', azureUrl:'#' },
            // Increased loads to create some days with total > 100%
            { id:'feat-alpha-A', type:'feature', parentEpic:'epic-alpha-1', title:'User Onboarding Overhaul', project:'alpha', start:'2025-01-01', end:'2025-02-28', capacity:[{team:'frontend', capacity:100},{team:'backend', capacity:100},{team:'devops', capacity:100}], status:'New', assignee:'Clara', description:'Redesign onboarding flow.', azureUrl:'#' },
            { id:'feat-alpha-B', type:'feature', parentEpic:'epic-alpha-1', title:'Search Scalability Upgrade', project:'alpha', start:'2025-03-01', end:'2025-04-30', capacity:[{team:'backend', capacity:12},{team:'devops', capacity:6}], status:'In Progress', assignee:'Dan', description:'Scale search services.', azureUrl:'#' },
            { id:'feat-alpha-C', type:'feature', parentEpic:'epic-alpha-1', title:'Reporting Dashboard Improvements', project:'alpha', start:'2025-05-01', end:'2025-06-15', capacity:[{team:'frontend', capacity:8},{team:'backend', capacity:6}], status:'New', assignee:'Eve', description:'Enhance reporting UI.', azureUrl:'#' },
            { id:'feat-beta-A', type:'feature', parentEpic:'epic-beta-1', title:'Error Tracking Integration', project:'beta', start:'2025-02-03', end:'2025-03-15', capacity:[{team:'backend', capacity:8},{team:'devops', capacity:4}], status:'New', assignee:'Frank', description:'Integrate error tracking tool.', azureUrl:'#' },
            { id:'feat-beta-B', type:'feature', parentEpic:'epic-beta-1', title:'Service Health Monitoring', project:'beta', start:'2025-04-01', end:'2025-06-30', capacity:[{team:'devops', capacity:10},{team:'backend', capacity:9}], status:'In Progress', assignee:'Grace', description:'Add health metrics and alerts.', azureUrl:'#' },
            { id:'feat-beta-C', type:'feature', parentEpic:'epic-beta-1', title:'Automated Failover', project:'beta', start:'2025-07-01', end:'2025-09-15', capacity:[{team:'devops', capacity:11},{team:'backend', capacity:7}], status:'New', assignee:'Hank', description:'Implement automated failover strategy.', azureUrl:'#' },
            { id:'feat-beta-C-followup', type:'feature', parentEpic:'epic-beta-1', title:'Failover Validation', project:'beta', start:'2025-09-16', end:'2025-09-30', capacity:[{team:'devops', capacity:5}], status:'New', assignee:'Hank', description:'Validation tasks.', azureUrl:'#', dependsOn:['feat-beta-C'] },
            // A one-day spike that further pushes over 100%
            { id:'feat-alpha-spike', type:'feature', title:'Alpha One-Day Spike', project:'alpha', start:'2025-02-05', end:'2025-02-05', capacity:[{team:'frontend', capacity:40},{team:'devops', capacity:30}], status:'New', assignee:'Ivy', description:'Investigate quick alpha edge case.', azureUrl:'#' },
            { id:'feat-alpha-A-sub', type:'feature', parentEpic:'epic-alpha-1', title:'Onboarding Email', project:'alpha', start:'2025-02-01', end:'2025-02-10', capacity:[{team:'frontend', capacity:20}], status:'New', assignee:'Clara', description:'Email task.', azureUrl:'#', dependsOn:['feat-alpha-A'] },
            { id:'feat-beta-maint', type:'feature', title:'Beta Maintenance Window', project:'beta', start:'2025-08-10', end:'2025-08-20', capacity:[{team:'backend', capacity:6}], status:'New', assignee:'Jake', description:'Scheduled maintenance tasks.', azureUrl:'#' }
        ].map(f => ({ ...f, original: { ...f }, changedFields: [], dirty: false }));
        this.scenarios = [{ id:'live', name:'Live Scenario', isLive:true, overrides:{}, stale:false }];
        this._idCounter = 1;
    }

    logCall(method, args) {
        // Developer-friendly logging for mock provider calls
        const argList = Array.from(args).map(a => JSON.stringify(a)).join(', ');
        console.log(`[ProviderMock] ${method} called with: ${argList}`);
    }

    nextId(prefix='id') { return `${prefix}_${this._idCounter++}`; }

    async getCapabilities() {
        this.logCall('getCapabilities', arguments);
        // Simulate capabilities fetch
        return { scenariosPersisted: true, colorsPersisted: false, batchUpdates: true };
    }

    async deleteScenario(id) {
        this.logCall('deleteScenario', arguments);
        const idx = this.scenarios.findIndex(s => s.id === id && !s.isLive);
        if (idx < 0) return false;
        this.scenarios.splice(idx, 1);
        return true;
    }
    async renameScenario(id, name) {
        this.logCall('renameScenario', arguments);
        const scenario = this.scenarios.find(s => s.id === id && !s.isLive);
        if (!scenario) throw { code: 'SCENARIO_NOT_FOUND', message: `Scenario ${id} not found or is live` };
        scenario.name = name;
        return { ...scenario };
    }
    async listScenarios() {
        this.logCall('listScenarios', arguments);
        return this.scenarios.map(s => ({
            id: s.id,
            name: s.name,
            isLive: s.isLive,
            overridesCount: Object.keys(s.overrides || {}).length,
            stale: !!s.stale
        }));
    }

    async publishBaseline(selectedOverrides, scenario) {
        this.logCall('publishBaseline', arguments);
        // Accept scenario or scenarioId; default to 'live'
        const scenarioId = scenario && typeof scenario === 'object' ? scenario.id : (typeof scenario === 'string' ? scenario : 'live');
        const s = this.scenarios.find(x => x.id === scenarioId);
        if (!s) throw { code: 'SCENARIO_NOT_FOUND', message: `Scenario ${scenarioId} not found` };
        const ids = selectedOverrides && selectedOverrides.length ? selectedOverrides.map(o => o.id) : Object.keys(s.overrides || {});
        let annotated = 0; const summary = [];
        for (const id of ids) {
            const ov = s.overrides[id];
            const f = this.features.find(x => x.id === id);
            if (!ov || !f) continue;
            annotated++;
            summary.push({ id, start: { from: f.start, to: ov.start }, end: { from: f.end, to: ov.end } });
            f.start = ov.start; f.end = ov.end; f.dirty = true; f.changedFields = ['start', 'end'];
        }
        const res = { ok: true, annotatedAt: new Date().toISOString(), count: annotated, details: summary };
        this.logCall('publishBaseline', res);
        return res;
    }

    async saveScenario(scenario) {
        this.logCall('saveScenario', arguments);
        let existing = this.scenarios.find(s => s.id === scenario.id);
        if (existing) {
            Object.assign(existing, scenario);
        } else {
            existing = { ...scenario, id: scenario.id || this.nextId('scen'), isLive: false };
            this.scenarios.push(existing);
        }
        const count = Object.keys(existing.overrides || {}).length;
        return { ...existing, savedAt: new Date().toISOString(), overridesCount: count };
    }
    async checkHealth() {
        this.logCall('checkHealth', arguments);
        // Simulate health check
        return { ok: true };
    }
    async saveConfig(config){
        this.logCall('saveConfig', arguments);
        // Simulate saving config data
        this.config = { ...config, savedAt: new Date().toISOString() };
        return { ok: true, email: config.email };
    }
    async setFeatureField(id, field, value) {
        this.logCall('setFeatureField', arguments);
        const f = this.features.find(x => x.id === id);
        if (!f) throw { code: 'FEATURE_NOT_FOUND', message: `Feature ${id} not found` };
        f[field] = value;
        f.dirty = true;
        if (!Array.isArray(f.changedFields)) f.changedFields = [];
        if (!f.changedFields.includes(field)) f.changedFields.push(field);
        return { ...f };
    }
    async batchSetFeatureDates(updates) {
        this.logCall('batchSetFeatureDates', arguments);
        const res = [];
        for (const u of updates) {
            res.push(await this.setFeatureDates(u.id, u.start, u.end));
        }
        return res;
    }
    async setFeatureDates(id, start, end) {
        this.logCall('setFeatureDates', arguments);
        const f = this.features.find(x => x.id === id);
        if (!f) throw { code: 'FEATURE_NOT_FOUND', message: `Feature ${id} not found` };
        f.start = start;
        f.end = end;
        f.dirty = true;
        f.changedFields = ['start', 'end'];
        return { ...f };
    }
    async getConfig() {
        this.logCall('getConfig', arguments);
        // Simulate config fetch
        return { developmentMode: true, apiBaseUrl: '/api', orgUrl: 'https://dev.azure.com/example', projectDefault: 'alpha' };
    }
    async getFeatures() {
        this.logCall('getFeatures', arguments);
        // Return features from instance state
        return this.features.map(f => ({ ...f }));
    }
    async getTeams() {
        this.logCall('getTeams', arguments);
        // Return teams from instance state
        return this.teams.map(t => ({ ...t }));
    }
    async getProjects() {
        this.logCall('getProjects', arguments);
        // Return projects from instance state
        return this.projects.map(p => ({ ...p }));
    }
  // ...other methods will be added in later steps
}
