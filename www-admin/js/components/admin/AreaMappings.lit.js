import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminAreaMappings extends LitElement{
  static styles = css`
    :host { display:block; height:100%; }
    h2 { margin-top:0; font-size:1.1rem; }
    .panel { padding:12px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; display:flex; flex-direction:column; height: calc(100vh - 160px); box-sizing:border-box; }
    .panel .editor { display:flex; flex:1 1 auto; min-height:0; }
    textarea { width:100%; flex:1 1 auto; min-height:0; font-family: monospace; font-size: 13px; padding:8px; box-sizing:border-box; border:1px solid #ddd; border-radius:6px; resize:vertical; }
    .actions { margin-top:12px; display:flex; gap:8px; align-items:center; }
    button { padding:8px 12px; border-radius:6px; border:1px solid #ccc; background:#f3f4f6; cursor:pointer; }
    .status { margin-left:8px; font-size:0.9rem; color:#333; }
    .refresh-row { display:flex; gap:8px; margin-top:10px; align-items:center; }
    input[type="text"] { padding:8px; border-radius:6px; border:1px solid #ddd; width:100%; box-sizing:border-box; }
  `;

  static properties = {
    content: { type: String },
    loading: { type: Boolean },
    statusMsg: { type: String },
    refreshPath: { type: String }
  };

  constructor(){
    super();
    this.content = '';
    this.loading = false;
    this.statusMsg = '';
    this.refreshPath = '';
    this.refreshAllLoading = false;
    this.refreshAllResults = null;
  }

  connectedCallback(){
    super.connectedCallback();
    this.loadMappings();
  }

  async loadMappings(){
    this.loading = true;
    try{
      const payload = await adminProvider.getAreaMappings();
      let raw = '';
      if (typeof payload === 'string') raw = payload;
      else if (payload === null || payload === undefined) raw = '';
      else raw = JSON.stringify(payload, null, 2);
      this.content = raw;
      this.statusMsg = '';
    }catch(e){ this.statusMsg = 'Error loading mappings'; }
    finally{ this.loading = false; }
  }

  async saveMappings(){
    this.statusMsg = 'Saving...';
    try{
      const parsed = this.content && this.content.length ? JSON.parse(this.content) : {};
      const res = await adminProvider.saveAreaMappings(parsed);
      if(!res || !res.ok){ this.statusMsg = 'Save failed'; return; }
      this.statusMsg = 'Saved';
    }catch(e){ this.statusMsg = 'Error saving mappings'; }
  }

  async refreshMapping(){
    if(!this.refreshPath){ this.statusMsg = 'Enter an area path to refresh'; return; }
    this.statusMsg = 'Refreshing...';
    try{
      const j = await adminProvider.refreshAreaMapping(this.refreshPath);
      if(!j || !j.ok){ this.statusMsg = 'Refresh failed'; return; }
      this.statusMsg = `Refreshed: ${j.plans?.length || 0} plans`;
      this.loadMappings();
    }catch(e){ this.statusMsg = 'Error refreshing mapping'; }
  }

  async _refreshAll(){
    this.refreshAllLoading = true;
    this.refreshAllResults = null;
    this.statusMsg = 'Refreshing all mappings...';
    try{
      const j = await adminProvider.refreshAllAreaMappings();
      if(!j || !j.ok){
        this.statusMsg = 'Refresh all failed';
        this.refreshAllLoading = false;
        return;
      }
      this.refreshAllResults = j.results || {};
      const okCount = Object.values(this.refreshAllResults).filter(i=>i && i.ok).length;
      this.statusMsg = `Refresh-all completed: ${okCount} succeeded, ${Object.keys(this.refreshAllResults).length - okCount} failed`;
      this.loadMappings();
    }catch(e){
      this.statusMsg = 'Error refreshing all mappings';
    }finally{
      this.refreshAllLoading = false;
    }
  }

  render(){
    return html`<section>
      <h2>Area -> Plan Mappings</h2>
      <div class="panel">
        <div class="editor">
          <textarea .value=${this.content} @input=${(e)=>{ this.content = e.target.value; }}></textarea>
        </div>
        <div class="actions">
          <button @click=${()=>this.saveMappings()}>Save</button>
          <button @click=${()=>this.loadMappings()}>Reload</button>
          <div class="status">${this.statusMsg}</div>
        </div>
        <div class="refresh-row">
          <input type="text" placeholder="Project\\Area\\Path to refresh" .value=${this.refreshPath} @input=${(e)=> this.refreshPath = e.target.value} />
          <button @click=${()=>this.refreshMapping()}>Refresh mapping for area</button>
        </div>
            <div class="actions" style="margin-top:12px;">
              <button ?disabled=${this.refreshAllLoading} @click=${()=>this._refreshAll()}>${this.refreshAllLoading? 'Refreshing...':'Refresh all configured mappings'}</button>
              <div class="status">${this.refreshAllLoading ? 'Refreshing all mappings, please wait...' : ''}</div>
            </div>
            ${this.refreshAllResults ? html`<div style="margin-top:12px;">
                <h3>Refresh Results</h3>
                <div style="max-height:200px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:6px; background:#fafafa;">
                  ${Object.entries(this.refreshAllResults).map(([area, info]) => html`<div style="margin-bottom:6px;"><strong>${area}</strong>: ${info.ok ? html`<span style="color:green">ok</span>` : html`<span style="color:red">error</span>`} ${!info.ok && info.error ? html`- ${info.error}` : ''}</div>`)}
                </div>
              </div>` : ''}
        
      </div>
    </section>`;
  }
}
customElements.define('admin-area-mappings', AdminAreaMappings);
