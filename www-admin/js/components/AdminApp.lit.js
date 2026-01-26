import { LitElement, html, css } from '/static/js/vendor/lit.js';

export class AdminApp extends LitElement {
  static properties = {
    activeSection: { type: String },
    sections: { type: Array }
  };

  static styles = css`
    :host { display:block; height:100vh; }
    .admin-root { display:flex; height:100vh; font-family: Arial, Helvetica, sans-serif; }
    .admin-sidebar { width:260px; background:#23344d; color:#ffffff; padding:16px 12px; box-sizing:border-box; display:flex; flex-direction:column; gap:12px; overflow:auto; }
    .sidebar-title { font-weight:700; margin-bottom:8px; font-size:1.05rem; }
    /* Make chips fill available width and stack vertically */
    .chip { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); color:var(--color-sidebar-text,#fff); background:transparent; cursor:pointer; width:100%; box-sizing:border-box; justify-content:flex-start; }
    .chip:hover { background: rgba(255,255,255,0.06); }
    .chip.active { background:#fff; color:#23344d; border-color:#fff; }
    .chip-badge { padding:2px 6px; border-radius:10px; font-size:12px; background: rgba(255,255,255,0.06); }
    .admin-content { flex:1; padding:18px; background:#fff; color:#222; overflow:auto; }
    .admin-content h2 { margin-top:0; }
    .panel { padding:12px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; }
  `;

  constructor(){
    super();
    this.activeSection = 'System';
    this.sections = ['System','Users','Projects','Teams'];
  }

  _onSelect(section){
    this.activeSection = section;
    this.requestUpdate();
  }

  renderSidebar(){
    return html`<aside class="admin-sidebar">
      <div class="sidebar-title">Admin</div>
      <div role="list">
        ${this.sections.map(s => html`<div class="chip ${s===this.activeSection? 'active':''}" role="button" tabindex="0" @click=${()=>this._onSelect(s)} @keydown=${(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); this._onSelect(s);} }}>${s}</div>`)}
      </div>
    </aside>`;
  }

  renderContent(){
    switch(this.activeSection){
      case 'System': return html`<admin-system></admin-system>`;
      case 'Users': return html`<admin-users></admin-users>`;
      case 'Projects': return html`<admin-projects></admin-projects>`;
      case 'Teams': return html`<admin-teams></admin-teams>`;
      default: return html`<div>Unknown section</div>`;
    }
  }

  render(){
    return html`<div class="admin-root">
      ${this.renderSidebar()}
      <main class="admin-content">${this.renderContent()}</main>
    </div>`;
  }
}

customElements.define('admin-app', AdminApp);
