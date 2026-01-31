import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminUsers extends LitElement{
  static styles = css`
    :host { display:block; }
    h2 { margin-top:0; font-size:1.1rem; }
    .panel { padding:12px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; }
    .cols { display:flex; gap:16px; }
    .col { flex:1; }
    ul { list-style:none; padding:0; margin:0; }
    li { display:flex; align-items:center; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f3f4f6; }
    button { margin-left:8px; }
    .controls { display:flex; gap:8px; margin-bottom:8px; }
  `;

  static properties = {
    users: { type: Array },
    admins: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    newUser: { type: String },
    newAdmin: { type: String }
  };

  constructor(){
    super();
    this.users = [];
    this.admins = [];
    this.loading = false;
    this.error = '';
    this.newUser = '';
    this.newAdmin = '';
    this.current = null;
  }

  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  async load(){
    this.loading = true;
    this.error = '';
    try{
      const data = await adminProvider.getUsers();
      if(!data){
        throw new Error('Failed to load users');
      }
      this.users = Array.isArray(data.users) ? data.users.slice().sort() : [];
      this.admins = Array.isArray(data.admins) ? data.admins.slice().sort() : [];
      this.current = data.current || null;
    }catch(e){
      console.error(e);
      this.error = String(e);
    }finally{
      this.loading = false;
    }
  }

  async save(){
    this.loading = true;
    this.error = '';
    try{
      const body = { users: this.users, admins: this.admins };
      const resp = await adminProvider.saveUsers(body);
      if(!resp || !resp.ok){
        throw new Error('Save failed');
      }
      await this.load();
    }catch(e){
      console.error(e);
      this.error = String(e);
    }finally{
      this.loading = false;
    }
  }

  addUser(){
    const v = (this.newUser || '').trim();
    if(!v) return;
    if(!this.users.includes(v)) this.users = [...this.users, v].sort();
    this.newUser = '';
    this.save();
  }

  addAdmin(){
    const v = (this.newAdmin || '').trim();
    if(!v) return;
    if(!this.admins.includes(v)) this.admins = [...this.admins, v].sort();
    // Ensure the user list contains the admin as well
    if(!this.users.includes(v)) this.users = [...this.users, v].sort();
    this.newAdmin = '';
    this.save();
  }

  removeFrom(listName, value){
    // Remove the value from both lists to keep storage consistent.
    this.users = this.users.filter(x=>x!==value);
    this.admins = this.admins.filter(x=>x!==value);
    this.save();
  }

  moveTo(targetList, value){
    // Promote/demote without deleting the counterpart entry.
    if(targetList === 'users'){
      // Demote from admin: remove from admins but keep user present
      this.admins = this.admins.filter(x=>x!==value);
      if(!this.users.includes(value)) this.users = [...this.users, value].sort();
    }else{
      // Promote to admin: add to admins and ensure user exists
      if(!this.admins.includes(value)) this.admins = [...this.admins, value].sort();
      if(!this.users.includes(value)) this.users = [...this.users, value].sort();
    }
    this.save();
  }

  render(){
    return html`<section>
      <h2>Users</h2>
      <div class="panel">
        ${this.loading ? html`<div>Loading…</div>` : ''}
        ${this.error ? html`<div style="color:tomato">${this.error}</div>` : ''}
        <div class="cols">
          <div class="col">
            <strong>Users</strong>
            <div class="controls">
              <input .value=${this.newUser} @input=${e=>this.newUser=e.target.value} placeholder="email@example.com" />
              <button @click=${()=>this.addUser()}>Add</button>
            </div>
            <ul>
              ${this.users.map(u => html`<li><span>${u}</span><span>${this.admins.includes(u) ? '' : html`<button @click=${()=>this.moveTo('admins', u)}>Make admin</button>`}${html`<button ?disabled=${this.current===u} @click=${()=>this.removeFrom('users', u)}>Remove</button>`}</span></li>`)}
            </ul>
          </div>
          <div class="col">
            <strong>Admins</strong>
            <div class="controls">
              <input .value=${this.newAdmin} @input=${e=>this.newAdmin=e.target.value} placeholder="admin@example.com" />
              <button @click=${()=>this.addAdmin()}>Add</button>
            </div>
            <ul>
              ${this.admins.map(a => html`<li><span>${a}</span><span>${this.current===a ? '' : html`<button @click=${()=>this.moveTo('users', a)}>Demote</button><button @click=${()=>this.removeFrom('admins', a)}>Remove</button>`}</span></li>`)}
            </ul>
          </div>
        </div>
      </div>
    </section>`;
  }
}
customElements.define('admin-users', AdminUsers);
