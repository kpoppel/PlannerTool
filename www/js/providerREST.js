// providerREST.js
// REST API implementation of the BackendProvider interface (stub)

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

    async refreshBaseline() {
        // Example: refresh baseline via REST API (stub)
        // return fetch('/api/baseline/refresh').then(res => res.json());
        return { ok: true, refreshedAt: new Date().toISOString() };
    }
    async saveScenario(scenario) {
        // Example: save scenario via REST API (stub)
        // return fetch('/api/scenarios', { method: 'POST', body: JSON.stringify(scenario) }).then(res => res.json());
        return { ...scenario, savedAt: new Date().toISOString() };
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
        const [resTasks, resTeams] = await Promise.all([
            fetch(url, { headers: this._headers() }),
            fetch('/api/teams', { headers: this._headers() })
        ]);
        if(!resTasks.ok) return [];
        const tasks = await resTasks.json();
        const teams = resTeams.ok ? await resTeams.json() : [];
        const retval = (tasks || []).map(f => ({ ...f, original: { ...f }, changedFields: [], dirty: false }));
        console.log("Fetched tasks:", retval);
        return retval;
    }

    async getTeams() {
        try{
            const res = await fetch('/api/teams', { headers: this._headers() });
            if(!res.ok) return [];
            let retval = await res.json();
            // TODO: move item selection state to scenario configuration
            retval = retval.map(team => ({ ...team, selected: true }));
            console.log("Fetched teams:", retval);
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
            console.log("Fetched projects:", retval);
            return retval
        }catch(err){ return {}; }
    }
  // ...other methods will be added in later steps
}
