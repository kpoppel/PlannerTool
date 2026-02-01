import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';
import '../SchemaForm.lit.js';

/**
 * BaseConfigComponent - Shared base class for admin config components
 * Provides common functionality for System, Projects, and Teams components
 */
export class BaseConfigComponent extends LitElement {
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
    
    .panel .editor { 
      display: flex; 
      flex: 1 1 auto; 
      min-height: 0; 
      overflow-y: auto;
      padding: 8px;
    }
    
    schema-form { width: 100%; }
    
    .actions { 
      margin-top: 12px; 
      display: flex; 
      gap: 8px; 
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
    
    button { 
      padding: 8px 16px; 
      border-radius: 6px; 
      border: 1px solid #ccc; 
      background: #f3f4f6; 
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    
    button:hover { background: #e5e7eb; }
    
    button.primary {
      background: #3b82f6;
      color: #fff;
      border-color: #3b82f6;
    }
    
    button.primary:hover { background: #2563eb; }
    
    .status { 
      margin-left: 8px; 
      font-size: 0.9rem; 
      color: #333; 
    }
    
    .status.success { color: #10b981; }
    .status.error { color: #ef4444; }
    
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: #6b7280;
    }
    
    .toggle-mode {
      margin-left: auto;
      font-size: 0.85rem;
      padding: 6px 12px;
    }
  `;

  static properties = {
    content: { type: Object },
    schema: { type: Object },
    loading: { type: Boolean },
    statusMsg: { type: String },
    statusType: { type: String },
    useRawMode: { type: Boolean }
  };

  constructor() {
    super();
    this.content = {};
    this.schema = null;
    this.loading = false;
    this.statusMsg = '';
    this.statusType = '';
    this.useRawMode = false;
  }

  // Abstract methods to be overridden by subclasses
  get configType() { throw new Error('configType must be implemented'); }
  get title() { throw new Error('title must be implemented'); }
  get defaultContent() { return {}; }
  
  connectedCallback() {
    super.connectedCallback();
    this.loadConfig();
  }

  async loadConfig() {
    this.loading = true;
    try {
      const [schemaData, contentData] = await Promise.all([
        adminProvider.getSchema(this.configType),
        this.fetchContent()
      ]);
      
      this.schema = schemaData;
      this.content = this.parseContent(contentData);
      this.statusMsg = '';
    } catch (e) { 
      this.statusMsg = `Error loading ${this.title.toLowerCase()}`; 
      this.statusType = 'error';
    } finally { 
      this.loading = false; 
    }
  }

  async fetchContent() {
    const methodName = `get${this.configType.charAt(0).toUpperCase() + this.configType.slice(1)}`;
    return adminProvider[methodName]();
  }

  parseContent(data) {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (e) {
        this.statusMsg = `Failed to parse ${this.title.toLowerCase()} configuration`;
        this.statusType = 'error';
        return this.defaultContent;
      }
    }
    return data || this.defaultContent;
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('schema-form');
    if (form && !this.useRawMode) {
      if (!form.validate()) {
        this.statusMsg = 'Please fix validation errors';
        this.statusType = 'error';
        return;
      }
      this.content = form.getData();
    }
    
    this.statusMsg = 'Saving...';
    this.statusType = '';
    
    try {
      const methodName = `save${this.configType.charAt(0).toUpperCase() + this.configType.slice(1)}`;
      await adminProvider[methodName](this.content);
      this.statusMsg = 'Saved successfully';
      this.statusType = 'success';
      setTimeout(() => { this.statusMsg = ''; }, 3000);
    } catch (e) { 
      this.statusMsg = 'Error saving';
      this.statusType = 'error';
    }
  }

  toggleMode() {
    this.useRawMode = !this.useRawMode;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading ${this.title.toLowerCase()}...</div>`;
    }

    return html`
      <section>
        <h2>${this.title}</h2>
        <div class="panel">
          <div class="editor">
            ${this.useRawMode ? html`
              <textarea 
                style="width: 100%; height: 100%; font-family: monospace; padding: 8px;"
                .value="${JSON.stringify(this.content, null, 2)}"
                @input="${(e) => { 
                  try { 
                    this.content = JSON.parse(e.target.value); 
                  } catch(err) { /* ignore parse errors while typing */ }
                }}"
              ></textarea>
            ` : html`
              <schema-form .schema="${this.schema}" .data="${this.content}"></schema-form>
            `}
          </div>
          <div class="actions">
            <button class="primary" @click="${this.saveConfig}">💾 Save</button>
            <button @click="${this.loadConfig}">🔄 Reload</button>
            <button class="toggle-mode" @click="${this.toggleMode}">
              ${this.useRawMode ? '📋 Form Mode' : '📝 Raw JSON'}
            </button>
            ${this.statusMsg ? html`
              <span class="status ${this.statusType}">${this.statusMsg}</span>
            ` : ''}
          </div>
        </div>
      </section>
    `;
  }
}
