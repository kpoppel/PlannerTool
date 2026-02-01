import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminUsers extends LitElement{
  static styles = css`
    :host { display: block; height: 100%; }
    h2 { margin-top: 0; font-size: 1.1rem; }
    
    .panel { 
      padding: 12px; 
      background: #fff; 
      border: 1px solid #e5e7eb; 
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      height: calc(100vh - 160px);
      box-sizing: border-box;
    }
    
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    
    .cols { 
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }
    
    @media (min-width: 768px) {
      .cols {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    
    .col {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .col-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 2px solid #e5e7eb;
    }
    
    .col-title {
      font-size: 1rem;
      font-weight: 600;
      color: #1f2937;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .badge {
      background: #3b82f6;
      color: white;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    
    .add-controls {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 12px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }
    
    .add-controls input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
      transition: border-color 0.2s;
    }
    
    .add-controls input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .add-controls input::placeholder {
      color: #9ca3af;
    }
    
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #d1d5db;
      background: white;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.2s;
      white-space: nowrap;
    }
    
    .btn:hover:not(:disabled) {
      background: #f3f4f6;
      border-color: #9ca3af;
    }
    
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .btn-primary {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
    }
    
    .btn-primary:hover:not(:disabled) {
      background: #2563eb;
      border-color: #2563eb;
    }
    
    .btn-danger {
      color: #ef4444;
      border-color: #fecaca;
    }
    
    .btn-danger:hover:not(:disabled) {
      background: #fef2f2;
      border-color: #ef4444;
    }
    
    .btn-small {
      padding: 4px 10px;
      font-size: 0.8rem;
    }
    
    .user-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 400px;
      overflow-y: auto;
    }
    
    .user-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      gap: 12px;
      transition: all 0.2s;
    }
    
    .user-item:hover {
      border-color: #d1d5db;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    .user-email {
      flex: 1;
      font-size: 0.9rem;
      color: #374151;
      word-break: break-word;
    }
    
    .user-current {
      font-weight: 600;
      color: #3b82f6;
    }
    
    .user-badge {
      padding: 2px 8px;
      background: #dbeafe;
      color: #1e40af;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    
    .user-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    
    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: #6b7280;
      font-size: 0.9rem;
    }
    
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: #6b7280;
    }
    
    .error {
      padding: 12px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      color: #ef4444;
      margin-bottom: 12px;
    }
    
    .footer {
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .status {
      font-size: 0.9rem;
      color: #6b7280;
    }
    
    .status.success {
      color: #10b981;
    }
  `;

  static properties = {
    users: { type: Array },
    admins: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    newUser: { type: String },
    newAdmin: { type: String },
    statusMsg: { type: String },
    statusType: { type: String }
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
    this.statusMsg = '';
    this.statusType = '';
  }

  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  async load(){
    this.loading = true;
    this.error = '';
    this.statusMsg = '';
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
    this.statusMsg = 'Saving...';
    this.statusType = '';
    this.error = '';
    
    try{
      const body = { users: this.users, admins: this.admins };
      const resp = await adminProvider.saveUsers(body);
      if(!resp || !resp.ok){
        throw new Error('Save failed');
      }
      
      this.statusMsg = 'Saved successfully';
      this.statusType = 'success';
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        if (this.statusType === 'success') {
          this.statusMsg = '';
          this.statusType = '';
          this.requestUpdate();
        }
      }, 3000);
      
      await this.load();
    }catch(e){
      console.error(e);
      this.error = String(e);
      this.statusMsg = 'Save failed';
      this.statusType = 'error';
    }
  }

  addUser(){
    const v = (this.newUser || '').trim();
    if(!v) return;
    
    // Basic email validation
    if(!v.includes('@')) {
      this.error = 'Please enter a valid email address';
      return;
    }
    
    if(!this.users.includes(v)) {
      this.users = [...this.users, v].sort();
      this.newUser = '';
      this.save();
    } else {
      this.error = 'User already exists';
    }
  }

  addAdmin(){
    const v = (this.newAdmin || '').trim();
    if(!v) return;
    
    // Basic email validation
    if(!v.includes('@')) {
      this.error = 'Please enter a valid email address';
      return;
    }
    
    if(!this.admins.includes(v)) {
      this.admins = [...this.admins, v].sort();
      // Ensure the user list contains the admin as well
      if(!this.users.includes(v)) this.users = [...this.users, v].sort();
      this.newAdmin = '';
      this.save();
    } else {
      this.error = 'Admin already exists';
    }
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

  _handleKeyDown(e, callback) {
    if (e.key === 'Enter') {
      callback();
    }
  }

  render(){
    if (this.loading && !this.users.length) {
      return html`
        <section>
          <h2>User Management</h2>
          <div class="panel">
            <div class="loading">Loading users...</div>
          </div>
        </section>
      `;
    }

    return html`<section>
      <h2>User Management</h2>
      <div class="panel">
        <div class="content">
          ${this.error ? html`<div class="error">${this.error}</div>` : ''}
          
          <div class="cols">
            <!-- Regular Users Column -->
            <div class="col">
              <div class="col-header">
                <div class="col-title">
                  <span>Regular Users</span>
                  <span class="badge">${this.users.length}</span>
                </div>
              </div>
              
              <div class="add-controls">
                <input 
                  .value=${this.newUser} 
                  @input=${e=>this.newUser=e.target.value}
                  @keydown=${e=>this._handleKeyDown(e, ()=>this.addUser())}
                  placeholder="user@example.com" 
                  type="email"
                />
                <button class="btn btn-primary" @click=${()=>this.addUser()}>Add User</button>
              </div>
              
              ${this.users.length === 0 ? html`
                <div class="empty-state">No users yet. Add the first user above.</div>
              ` : html`
                <ul class="user-list">
                  ${this.users.map(u => html`
                    <li class="user-item">
                      <span class="user-email ${this.current === u ? 'user-current' : ''}">
                        ${u}
                        ${this.current === u ? html`<span class="user-badge">You</span>` : ''}
                      </span>
                      <div class="user-actions">
                        ${this.admins.includes(u) ? html`
                          <span class="user-badge">Admin</span>
                        ` : html`
                          <button 
                            class="btn btn-small" 
                            @click=${()=>this.moveTo('admins', u)}
                            title="Promote to admin"
                          >
                            Make Admin
                          </button>
                        `}
                        <button 
                          class="btn btn-small btn-danger" 
                          ?disabled=${this.current === u}
                          @click=${()=>this.removeFrom('users', u)}
                          title="Remove user"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  `)}
                </ul>
              `}
            </div>
            
            <!-- Admins Column -->
            <div class="col">
              <div class="col-header">
                <div class="col-title">
                  <span>Administrators</span>
                  <span class="badge">${this.admins.length}</span>
                </div>
              </div>
              
              <div class="add-controls">
                <input 
                  .value=${this.newAdmin} 
                  @input=${e=>this.newAdmin=e.target.value}
                  @keydown=${e=>this._handleKeyDown(e, ()=>this.addAdmin())}
                  placeholder="admin@example.com"
                  type="email"
                />
                <button class="btn btn-primary" @click=${()=>this.addAdmin()}>Add Admin</button>
              </div>
              
              ${this.admins.length === 0 ? html`
                <div class="empty-state">No admins yet. Add the first admin above.</div>
              ` : html`
                <ul class="user-list">
                  ${this.admins.map(a => html`
                    <li class="user-item">
                      <span class="user-email ${this.current === a ? 'user-current' : ''}">
                        ${a}
                        ${this.current === a ? html`<span class="user-badge">You</span>` : ''}
                      </span>
                      <div class="user-actions">
                        ${this.current === a ? '' : html`
                          <button 
                            class="btn btn-small" 
                            @click=${()=>this.moveTo('users', a)}
                            title="Demote to regular user"
                          >
                            Demote
                          </button>
                          <button 
                            class="btn btn-small btn-danger" 
                            @click=${()=>this.removeFrom('admins', a)}
                            title="Remove admin"
                          >
                            Remove
                          </button>
                        `}
                      </div>
                    </li>
                  `)}
                </ul>
              `}
            </div>
          </div>
        </div>
        
        <div class="footer">
          <button class="btn" @click=${()=>this.load()}>Reload</button>
          <div class="status ${this.statusType}">${this.statusMsg}</div>
        </div>
      </div>
    </section>`;
  }
}
customElements.define('admin-users', AdminUsers);
