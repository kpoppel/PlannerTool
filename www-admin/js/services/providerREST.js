// Admin-side providerREST for admin UI. Mirrors user `providerREST` helpers
// but keeps admin API calls separate and scoped to the admin frontend.
export class AdminProviderREST {
  constructor(){
    // Admin UI uses same-origin credentials (cookie/session managed by server)
  }

  _headers(extra){
    return Object.assign({}, extra || {});
  }

  async getAreaMappings(){
    try{
      const res = await fetch('/admin/v1/area-mappings', { method: 'GET', credentials: 'same-origin' });
      if(!res.ok) return {};
      const j = await res.json();
      return j.content || {};
    }catch(err){ console.error('AdminProviderREST:getAreaMappings', err); return {}; }
  }

  async saveAreaMappings(mappings){
    try{
      const body = JSON.stringify({ content: mappings });
      const res = await fetch('/admin/v1/area-mappings', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:saveAreaMappings', err); return { ok:false, error: String(err) }; }
  }

  // --- Projects/System/Teams/Users helpers ---
  async getProjects(){
    try{
      const res = await fetch('/admin/v1/projects', { method: 'GET', credentials: 'same-origin' });
      if(!res.ok) return null;
      const j = await res.json();
      return j.content || null;
    }catch(err){ console.error('AdminProviderREST:getProjects', err); return null; }
  }

  async saveProjects(content){
    try{
      const body = JSON.stringify({ content: content });
      const res = await fetch('/admin/v1/projects', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:saveProjects', err); return { ok:false, error: String(err) }; }
  }

  async getSystem(){
    try{
      const res = await fetch('/admin/v1/system', { method: 'GET', credentials: 'same-origin' });
      if(!res.ok) return null;
      const j = await res.json();
      return j.content || null;
    }catch(err){ console.error('AdminProviderREST:getSystem', err); return null; }
  }

  async saveSystem(content){
    try{
      const body = JSON.stringify({ content: content });
      const res = await fetch('/admin/v1/system', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:saveSystem', err); return { ok:false, error: String(err) }; }
  }

  async getTeams(){
    try{
      const res = await fetch('/admin/v1/teams', { method: 'GET', credentials: 'same-origin' });
      if(!res.ok) return null;
      const j = await res.json();
      return j.content || null;
    }catch(err){ console.error('AdminProviderREST:getTeams', err); return null; }
  }

  async saveTeams(content){
    try{
      const body = JSON.stringify({ content: content });
      const res = await fetch('/admin/v1/teams', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:saveTeams', err); return { ok:false, error: String(err) }; }
  }

  async getCost(){
    try{
      const res = await fetch('/admin/v1/cost', { method: 'GET', credentials: 'same-origin' });
      if(!res.ok) return null;
      const j = await res.json();
      return j.content || null;
    }catch(err){ console.error('AdminProviderREST:getCost', err); return null; }
  }

  async saveCost(content){
    try{
      const body = JSON.stringify({ content: content });
      const res = await fetch('/admin/v1/cost', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:saveCost', err); return { ok:false, error: String(err) }; }
  }

  async getUsers(){
    try{
      const res = await fetch('/admin/v1/users', { method: 'GET', credentials: 'same-origin' });
      if(!res.ok) return null;
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:getUsers', err); return null; }
  }

  async saveUsers(payload){
    try{
      const res = await fetch('/admin/v1/users', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body: JSON.stringify(payload) });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:saveUsers', err); return { ok:false, error: String(err) }; }
  }

  async refreshAreaMapping(areaPath){
    try{
      const body = JSON.stringify({ area_path: areaPath });
      const res = await fetch('/admin/v1/area-mapping/refresh', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:refreshAreaMapping', err); return { ok:false, error: String(err) }; }
  }

  async refreshAllAreaMappings(){
    try{
      const res = await fetch('/admin/v1/area-mapping/refresh-all', { method: 'POST', credentials: 'same-origin' });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:refreshAllAreaMappings', err); return { ok:false, error: String(err) }; }
  }

  async togglePlanEnabled(projectId, areaPath, planId, enabled){
    try{
      const body = JSON.stringify({ project_id: projectId, area_path: areaPath, plan_id: planId, enabled: enabled });
      const res = await fetch('/admin/v1/area-mapping/toggle-plan', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:togglePlanEnabled', err); return { ok:false, error: String(err) }; }
  }

  async getSchema(configType){
    try{
      const res = await fetch(`/admin/v1/schema/${configType}`, { method: 'GET', credentials: 'same-origin' });
      if(!res.ok) return null;
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:getSchema', err); return null; }
  }

  async getIterations(){
    try{
      const res = await fetch('/admin/v1/iterations', { method: 'GET', credentials: 'same-origin' });
      if(!res.ok) return null;
      const j = await res.json();
      return j.content || null;
    }catch(err){ console.error('AdminProviderREST:getIterations', err); return null; }
  }

  async saveIterations(content){
    try{
      const body = JSON.stringify({ content: content });
      const res = await fetch('/admin/v1/iterations', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { ok:false, error: `HTTP ${res.status}` };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:saveIterations', err); return { ok:false, error: String(err) }; }
  }

  async browseIterations(payload){
    try{
      const body = JSON.stringify(payload);
      const res = await fetch('/admin/v1/iterations/browse', { method: 'POST', credentials: 'same-origin', headers: this._headers({ 'Content-Type':'application/json' }), body });
      if(!res.ok) return { iterations: [] };
      return await res.json();
    }catch(err){ console.error('AdminProviderREST:browseIterations', err); return { iterations: [] }; }
  }
}

// Export a default instance for simple imports
export const adminProvider = new AdminProviderREST();

