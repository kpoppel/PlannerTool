import { LitElement, html, css } from '/static/js/vendor/lit.js';

export class AdminProjects extends LitElement{
  static styles = css`
    :host { display:block; height:100%; }
    h2 { margin-top:0; font-size:1.1rem; }
     .panel { padding:12px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; display:flex; flex-direction:column; height: calc(100vh - 160px); box-sizing:border-box; }
     /* Make the editor wrapper a flexible container so the textarea
       (which is inside) can grow to fill available space. Leave
       the actions row alone so it doesn't expand. */
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
    this.loadProjects();
  }

  async loadProjects(){
    this.loading = true;
    try{
      const res = await fetch('/admin/v1/projects', { method: 'GET', credentials: 'same-origin' });
      if(!res.ok){
        this.statusMsg = 'Failed to load projects';
        return;
      }
      const j = await res.json();
      const payload = j.content;
      let raw = '';
      // Server now returns structured JSON when possible. If `content` is
      // an object/array, pretty-print it here. If it's a string (e.g. YAML
      // or raw text), use it as-is.
      if (typeof payload === 'string') {
        raw = payload;
      } else if (payload === null || payload === undefined) {
        raw = '';
      } else {
        try {
          raw = JSON.stringify(payload, null, 2);
        } catch (e) {
          raw = String(payload);
        }
      }
      this.content = raw;
      this.statusMsg = '';
    }catch(e){
      this.statusMsg = 'Error loading projects';
    }finally{
      this.loading = false;
    }
  }

  async saveProjects(){
    this.statusMsg = 'Saving...';
    try{
      const res = await fetch('/admin/v1/projects', { method: 'POST', credentials: 'same-origin', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ content: this.content }) });
      if(!res.ok){
        this.statusMsg = 'Save failed';
        return;
      }
      const j = await res.json();
      if(j && j.ok){
        this.statusMsg = 'Saved';
      }else{
        this.statusMsg = 'Save returned unexpected response';
      }
    }catch(e){
      this.statusMsg = 'Error saving projects';
    }
  }

  render(){
    return html`<section>
      <h2>Projects</h2>
      <div class="panel">
        <div class="editor">
          <textarea .value=${this.content} @input=${(e)=>{ this.content = e.target.value; }}></textarea>
        </div>
        <div class="actions">
          <button @click=${()=>this.saveProjects()}>Save</button>
          <button @click=${()=>this.loadProjects()}>Reload</button>
          <div class="status">${this.statusMsg}</div>
        </div>
      </div>
    </section>`;
  }
}
customElements.define('admin-projects', AdminProjects);
