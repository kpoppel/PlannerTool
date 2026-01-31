import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminTeams extends LitElement{
  static styles = css`
    :host { display:block; height:100%; }
    h2 { margin-top:0; font-size:1.1rem; }
    .panel { padding:12px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; display:flex; flex-direction:column; height: calc(100vh - 160px); box-sizing:border-box; }
    .panel .editor { display:flex; flex:1 1 auto; min-height:0; }
    textarea { width:100%; flex:1 1 auto; min-height:0; font-family: monospace; font-size: 13px; padding:8px; box-sizing:border-box; border:1px solid #ddd; border-radius:6px; resize:vertical; }
    .actions { margin-top:12px; display:flex; gap:8px; align-items:center; }
    button { padding:8px 12px; border-radius:6px; border:1px solid #ccc; background:#f3f4f6; cursor:pointer; }
    .status { margin-left:8px; font-size:0.9rem; color:#333; }
  `;

  static properties = {
    content: { type: String },
    loading: { type: Boolean },
    statusMsg: { type: String }
  };

  constructor(){
    super();
    this.content = '';
    this.loading = false;
    this.statusMsg = '';
  }

  connectedCallback(){
    super.connectedCallback();
    this.loadTeams();
  }

  async loadTeams(){
    this.loading = true;
    try{
      const payload = await adminProvider.getTeams();
      if (typeof payload === 'string') {
        this.content = payload;
      } else if (payload === null || payload === undefined) {
        this.content = '';
      } else {
        try{
          this.content = JSON.stringify(payload, null, 2);
        }catch(e){
          this.content = String(payload);
        }
      }
      this.statusMsg = '';
    }catch(e){ this.statusMsg = 'Error loading teams'; }
    finally{ this.loading = false; }
  }

  async saveTeams(){
    this.statusMsg = 'Saving...';
    try{
      const res = await adminProvider.saveTeams(this.content);
      if(!res || !res.ok){ this.statusMsg = 'Save failed'; return; }
      this.statusMsg = 'Saved';
    }catch(e){ this.statusMsg = 'Error saving teams'; }
  }

  render(){
    return html`<section>
      <h2>Teams</h2>
      <div class="panel">
        <div class="editor"><textarea .value=${this.content} @input=${(e)=>{ this.content = e.target.value; }}></textarea></div>
        <div class="actions">
          <button @click=${()=>this.saveTeams()}>Save</button>
          <button @click=${()=>this.loadTeams()}>Reload</button>
          <div class="status">${this.statusMsg}</div>
        </div>
      </div>
    </section>`;
  }
}
customElements.define('admin-teams', AdminTeams);
