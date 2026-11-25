import { LitElement, html, css } from '/static/js/vendor/lit.js';
import '../../../js/components/TopMenu.lit.js';
import { getAdminSections } from '../../../js/services/adminNavigation.js';
import './admin/GlobalSettings.lit.js';
import './admin/AdoProcesses.lit.js';
import './admin/DataSources.lit.js';
import './admin/Plugins.lit.js';
import './admin/BackupSnapshots.lit.js';
import './admin/LocalPlans.lit.js';
import './admin/LocalCatalogue.lit.js';

export class AdminApp extends LitElement {
  static properties = {
    activeSection: { type: String },
    activeView: { type: String },
    sections: { type: Array },
    permissions: { type: Array },
    manageBackupSnapshots: { type: Boolean },
    taskBackendId: { type: String },
  };

  static styles = css`
    :host {
      display: block;
      height: 100vh;
      padding-top: 40px;
      box-sizing: border-box;
      font-family: Arial, Helvetica, sans-serif;
      --color-sidebar-bg: #23344d;
      --sidebar-width: 260px;
    }
    .admin-root {
      display: flex;
      height: 100%;
      font-family: Arial, Helvetica, sans-serif;
    }
    .admin-sidebar {
      width: 260px;
      background: #23344d;
      color: #ffffff;
      padding: 16px 12px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow: auto;
    }
    .sidebar-title {
      font-weight: 700;
      margin-bottom: 8px;
      font-size: 1.05rem;
    }
    /* Make chips fill available width and stack vertically */
    .chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--color-sidebar-text, #fff);
      background: transparent;
      cursor: pointer;
      width: 100%;
      box-sizing: border-box;
      justify-content: flex-start;
    }
    .chip:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .chip.active {
      background: #fff;
      color: #23344d;
      border-color: #fff;
    }
    .chip-badge {
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 12px;
      background: rgba(255, 255, 255, 0.06);
    }
    .admin-content {
      flex: 1;
      padding: 18px;
      background: #fff;
      color: #222;
      overflow: auto;
    }
    .admin-content h2 {
      margin-top: 0;
    }
    .hub-nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .hub-nav button[aria-current='page'] { font-weight: 700; }
    .panel {
      padding: 12px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }
  `;

  constructor() {
    super();
    this.activeSection = '';
    this.activeView = '';
    this.sections = [];
    this.permissions = [];
    this.manageBackupSnapshots = false;
    this.taskBackendId = '';
    this._onHashChange = () => this._selectHashSection();
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('hashchange', this._onHashChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this._onHashChange);
  }

  get _navigation() {
    return getAdminSections(this.permissions, this.taskBackendId, this.manageBackupSnapshots);
  }

  setPermissions(permissions, taskBackendId) {
    this.permissions = permissions;
    this.taskBackendId = taskBackendId;
    this._refreshSections();
  }

  _refreshSections() {
    const navigation = this._navigation;
    this.sections = navigation.map((section) => section.label);
    if (!this.sections.includes(this.activeSection)) {
      this.activeSection = '';
      this.activeView = '';
      if (navigation.length > 0) this._activate(navigation[0], this._defaultView(navigation[0]));
    } else {
      const current = navigation.find((section) => section.label === this.activeSection);
      if (current.views && !current.views.some((view) => view.id === this.activeView)) {
        this._activate(current, this._defaultView(current));
      }
    }
    this._selectHashSection();
  }

  _defaultView(section) {
    return section.views ? section.views[0].id : '';
  }

  _activate(section, view) {
    this.activeSection = section.label;
    this.activeView = view;
  }

  _writeHash(id) {
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, '', url.href);
  }

  _selectHashSection() {
    const id = window.location.hash.slice(1);
    for (const section of this._navigation) {
      const view = id === section.id ? this._defaultView(section) : id;
      if (id !== section.id && !(section.views && section.views.some((entry) => entry.id === id))) {
        continue;
      }
      if (this._mayLeaveSection(view)) this._activate(section, view);
      else this._writeHash(this.activeView);
      return;
    }
  }

  async firstUpdated() {
    if (!this.permissions.includes('admin')) return;
    // Check feature flag for backup snapshots visibility
    try {
      const res = await fetch((window.APP_BASE_URL || '') + '/admin/v1/system');
      if (res.ok) {
        const data = await res.json();
        this.manageBackupSnapshots = data.content.feature_flags.manage_backup_snapshots === true;
        this._refreshSections();
      }
    } catch (e) {
      console.warn('AdminApp: failed to check feature flags', e);
    }
  }

  _mayLeaveSection(view) {
    if ((this.activeView !== 'iterations' && this.activeView !== 'local-iterations')
      || this.activeView === view) return true;
    const editor = this.shadowRoot.querySelector('admin-iterations');
    return editor === null || editor.mayLeave();
  }

  _onSelect(section) {
    const target = this._navigation.find((entry) => entry.label === section);
    if (target === undefined) return;
    const view = this._defaultView(target);
    if (!this._mayLeaveSection(view)) return;
    this._activate(target, view);
    this._writeHash(target.id);
  }

  renderSidebar() {
    return html`<aside class="admin-sidebar">
      <div class="sidebar-title">Admin</div>
      <div role="list">
        ${this.sections.map(
          (s) =>
            html`<div
              class="chip ${s === this.activeSection ? 'active' : ''}"
              role="button"
              tabindex="0"
              @click=${() => this._onSelect(s)}
              @keydown=${(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  this._onSelect(s);
                }
              }}
            >
              ${s}
            </div>`
        )}
      </div>
    </aside>`;
  }

  renderContent() {
    const section = this._navigation.find((entry) => entry.label === this.activeSection);
    if (section === undefined) return html``;
    if (section.views) {
      if (!section.views.some((view) => view.id === this.activeView)) return html``;
      return html`<nav class="hub-nav" aria-label=${section.label}>
        ${section.views.map((view) => html`<button type="button"
          aria-current=${view.id === this.activeView ? 'page' : 'false'}
          @click=${() => {
            if (!this._mayLeaveSection(view.id)) return;
            this._activate(section, view.id);
            this._writeHash(view.id);
          }}>${view.label}</button>`)}
      </nav>${this._renderBackendView()}`;
    }
    switch (this.activeSection) {
      case 'Server':
        return html`<admin-system></admin-system>`;
      case 'Data Sources':
        return html`<admin-data-sources></admin-data-sources>`;
      case 'Users':
        return html`<admin-users .taskBackendId=${this.taskBackendId}></admin-users>`;
      case 'Workforce':
        return html`<admin-workforce .permissions=${this.permissions}></admin-workforce>`;
      case 'Utilities':
        return html`<admin-utilities></admin-utilities>`;
      case 'Plugins':
        return html`<admin-plugins></admin-plugins>`;
      case 'Backup Snapshots':
        return html`<admin-backup-snapshots></admin-backup-snapshots>`;
      default:
        return html`<div>Unknown section</div>`;
    }
  }

  _renderBackendView() {
    switch (this.activeView) {
      case 'projects': return html`<admin-projects .permissions=${this.permissions}></admin-projects>`;
      case 'ado-processes': return html`<admin-ado-processes></admin-ado-processes>`;
      case 'global-project-settings': return html`<admin-global-settings></admin-global-settings>`;
      case 'iterations': return html`<admin-iterations></admin-iterations>`;
      case 'area-mappings': return html`<area-mappings-new></area-mappings-new>`;
      case 'ado-connection': return html`<admin-data-sources mode="ado"></admin-data-sources>`;
      case 'local-projects': return html`<admin-local-plans></admin-local-plans>`;
      case 'local-catalogue': return html`<admin-local-catalogue></admin-local-catalogue>`;
      case 'local-markers': return html`<admin-local-plans mode="markers"></admin-local-plans>`;
      case 'local-iterations': return html`<admin-iterations .local=${true}></admin-iterations>`;
      default: return html``;
    }
  }

  render() {
    return html`<top-menu-bar application="admin" .permissions=${this.permissions}
      .manageBackupSnapshots=${this.manageBackupSnapshots}
      .taskBackendId=${this.taskBackendId}
      .baseUrl=${window.APP_BASE_URL}></top-menu-bar>
    <div class="admin-root">
      ${this.renderSidebar()}
      <main class="admin-content">${this.renderContent()}</main>
    </div>`;
  }
}

customElements.define('admin-app', AdminApp);
