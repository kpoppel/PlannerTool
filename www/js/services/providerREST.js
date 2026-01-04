// providerREST.js
// REST API implementation of the BackendProvider interface (stub)
import { bus } from '../core/EventBus.js';
import { DataEvents } from '../core/EventRegistry.js';

export class ProviderREST {
    constructor(){
        this.sessionId = null;
    }
    async init(){
        // Attempt to read user email from local storage prefs
        let email = null;
        try {
            const raw = localStorage.getItem('az_planner:user_prefs:v1');
            const prefs = raw ? JSON.parse(raw) : {};
            email = prefs['user.email'] || null;
            console.log("Loaded user email from prefs:", email);
        } catch {
            // If no email was found, don't do anything. The user needs to push the config first.
            return;
        }
        //if(!email){
            // // As a fallback, prompt the user for an email; in production, replace with real auth/user profile
            // email = window.prompt('Enter your email to start a session:', 'user@example.com');
            // try{
            //     const raw = localStorage.getItem('az_planner:user_prefs:v1');
            //     const prefs = raw ? JSON.parse(raw) : {};
            //     prefs['user.email'] = email;
            //     localStorage.setItem('az_planner:user_prefs:v1', JSON.stringify(prefs));
            //}catch{}
        //}
        // Create a session via POST /api/session
        try{
            const res = await fetch('/api/session', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email }) });
            if(res.ok){
                const data = await res.json();
                this.sessionId = data.sessionId;
                // Preload scenarios for the user so UI shows saved items
                console.log("Created session, loading scenarios...");
                try { await this.loadAllScenarios(); } catch {}
                console.log("Completed loading scenarios...");
            } else {
                console.error('Failed to create session', res.status);
            }
        }catch(err){ console.error('Session creation error', err); }
    }

    _headers(extra){
        const h = Object.assign({}, extra || {});
        if(this.sessionId){ h['X-Session-Id'] = this.sessionId; }
        return h;
    }

    async getCapabilities() {
        // Example: fetch capabilities via REST API (stub)
        // return fetch('/api/capabilities').then(res => res.json());
        return { scenariosPersisted: true, colorsPersisted: true, batchUpdates: true };
    }

    async listScenarios() {
        try{
            const res = await fetch('/api/scenario', { headers: this._headers() });
            if(!res.ok) return [];
            const list = await res.json();
            try{ bus.emit(DataEvents.SCENARIOS_CHANGED, list); }catch{}
            console.log("providerREST:listScenarios - Fetched tasks:", list);
            return list;
        }catch(err){ return []; }
    }
    async loadAllScenarios(){
        const metas = await this.listScenarios();
        const scenarios = [];
        for(const m of metas){
            // Load all scenarios from server (server should not send baseline, but we can handle it)
            if(!m || !m.id) continue;
            const data = await this.getScenario(m.id);
            if(data){ scenarios.push(data); }
        }
        try{ bus.emit(DataEvents.SCENARIOS_DATA, scenarios); }catch{}
        console.log("providerREST:loadAllScenarios - Fetched scenarios:", scenarios);
        return scenarios;
    }
    async getScenario(id) {
        try{
            const res = await fetch(`/api/scenario?id=${encodeURIComponent(id)}`, { headers: this._headers() });
            if(!res.ok) return null;
            const data = await res.json();
            console.log("providerREST:getScenario - Fetched scenario:", data);
            return data;
        }catch(err){ return null; }
    }

    async saveScenario(scenario) {
        // Client-side guard: Don't attempt to save readonly scenarios
        if (scenario.readonly) {
            console.warn('[providerREST] Attempted to save readonly scenario:', scenario.id);
            return { ok: false, error: 'Cannot save readonly scenario' };
        }
        
        try{
            const body = JSON.stringify({ op: 'save', data: scenario });
            const res = await fetch('/api/scenario', { method: 'POST', headers: this._headers({ 'Content-Type':'application/json' }), body });
            if(!res.ok){ return { ok:false, error:`HTTP ${res.status}` }; }
            const meta = await res.json();
            try{ const list = await this.listScenarios(); bus.emit(DataEvents.SCENARIOS_CHANGED, list); }catch{}
            console.log("providerREST:saveScenario - Fetched tasks:", meta);
            return meta;
        }catch(err){ return { ok:false, error:String(err) }; }
    }

    async renameScenario(id, name) {
        // Persist name by saving the scenario metadata; backend stores raw structure.
        try{
            const body = JSON.stringify({ op: 'save', data: { id, name } });
            const res = await fetch('/api/scenario', { method: 'POST', headers: this._headers({ 'Content-Type':'application/json' }), body });
            if(!res.ok){ return { ok:false, error:`HTTP ${res.status}` }; }
            const meta = await res.json();
                try{ const list = await this.listScenarios(); bus.emit(DataEvents.SCENARIOS_CHANGED, list); }catch{}
            console.log("providerREST:renameScenario - Fetched tasks:", meta);
            return meta;
        }catch(err){ return { ok:false, error:String(err) }; }
    }

    async deleteScenario(id) {
        try{
            const body = JSON.stringify({ op: 'delete', data: { id } });
            const res = await fetch('/api/scenario', { method: 'POST', headers: this._headers({ 'Content-Type':'application/json' }), body });
            if(!res.ok){ return false; }
            const data = await res.json();
            const ok = !!data?.ok;
            if(ok){
                try{ const list = await this.listScenarios(); bus.emit(DataEvents.SCENARIOS_CHANGED, list); }catch{}
            }
            console.log("providerREST:deleteScenario - Fetched tasks:", data);
            return ok;
        }catch(err){ return false; }
    }

    async publishBaseline(selectedOverrides) {
        try{
            const res = await fetch('/api/tasks', { method:'POST', headers: this._headers({ 'Content-Type':'application/json' }), body: JSON.stringify(selectedOverrides) });
            if(!res.ok){ return { ok:false, error:`HTTP ${res.status}` }; }
            return await res.json();
        }catch(err){ return { ok:false, error: String(err) }; }
    }

    async saveConfig(config) {
        try{
            const res = await fetch('/api/config', { method: 'POST', headers: this._headers({ 'Content-Type':'application/json' }), body: JSON.stringify(config) });
            return await res.json();
        }catch(err){ return { ok:false, error: String(err) }; }
    }

    async checkHealth() {
        // Perform an actual fetch to /api/health and return parsed JSON.
        try {
            const res = await fetch('/api/health');
            if (!res.ok) return { status: 'error' };
            return await res.json();
        } catch (err) {
            return { status: 'error', error: String(err) };
        }
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

    async getFeatures(project) {
        const url = project ? `/api/tasks?project=${encodeURIComponent(project)}` : '/api/tasks';
        const resTasks = await fetch(url, { headers: this._headers() });
        if(!resTasks.ok) return [];
        const tasks = await resTasks.json();
        // Calculate derived fields used in the frontend
        // - parentEpic is used for relating Features to their parent Epic
        function getParent(f){
            const parentRel = f.relations.find(r => r.type === 'Parent');
            return parentRel ? parentRel.id : null;
        }
        //const parentEpic = tasks.relations ? tasks.relations.find(r => r.type === 'Parent') : null;
        //console.log("Parent Epic:", parentEpic);
        const retval = (tasks || []).map(f => ({ ...f, parentEpic: getParent(f), original: { ...f }, changedFields: [], dirty: false }));
        console.log("providerREST:getFeatures - Fetched tasks:", retval);
        return retval;
    }

    async getTeams() {
        try{
            const res = await fetch('/api/teams', { headers: this._headers() });
            if(!res.ok) return [];
            let retval = await res.json();
            // TODO: move item selection state to scenario configuration
            retval = retval.map(team => ({ ...team, selected: true }));
            console.log("providerREST:getTeams - Fetched teams:", retval);
            return retval
        }catch(err){ return {}; }
    }

    async getProjects() {
        try{
            const res = await fetch('/api/projects', { headers: this._headers() });
            if(!res.ok) return [];
            let retval = await res.json();
            // TODO: move item selection state to scenario configuration
            retval = retval.map(project => ({ ...project, selected: true }));
            console.log("providerREST:getProjects - Fetched projects:", retval);
            return retval
        }catch(err){ return {}; }
    }
    
    // Fetch cost data (GET) or request a recalculation with payload (POST)
    async getCost(payload){
        try{
            // If no payload provided, GET cached cost for session (or schema when unauthenticated)
            if(!payload){
                const res = await fetch('/api/cost', { headers: this._headers() });
                if(!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            }

            // If payload is an array, treat as legacy overrides array
            if(Array.isArray(payload)){
                const res = await fetch('/api/cost', { method: 'POST', headers: this._headers({ 'Content-Type':'application/json' }), body: JSON.stringify({ overrides: payload }) });
                if(!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            }

            // If payload is an object, forward it directly (supports { features }, { scenarioId } etc.)
            if(typeof payload === 'object'){
                const res = await fetch('/api/cost', { method: 'POST', headers: this._headers({ 'Content-Type':'application/json' }), body: JSON.stringify(payload) });
                if(!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            }

            // Fallback to GET
            const res = await fetch('/api/cost', { headers: this._headers() });
            if(!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        }catch(err){
            console.error('providerREST:getCost error', err);
            throw err;
        }
    }
    
    async getCostTeams(){
        try{
            const res = await fetch('/api/cost/teams', { headers: this._headers() });
            if(!res.ok) return [];
            const data = await res.json();
            console.log('providerREST:getCostTeams - Fetched cost teams', data);
            return data;
        }catch(err){ console.error('providerREST:getCostTeams error', err); return []; }
    }
  // ...other methods will be added in later steps
}
