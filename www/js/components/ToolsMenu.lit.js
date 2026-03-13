import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents, ViewEvents } from '../core/EventRegistry.js';
import { pluginManager } from '../core/PluginManager.js';
import { state } from '../services/State.js';

export class ToolsMenuLit extends LitElement {
  static properties = {
    // no external properties needed; plugin list comes from pluginManager
    plugins: { type: Array }
  };

  static styles = css`
    :host { display:block; }
    .menu-popover {
      background: var(--color-sidebar-bg);
      color: var(--color-sidebar-text);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      /* allow width to grow to fit content, but cap it */
      width: max-content;
      max-width: 420px;
      max-height: 520px;
      overflow-y: auto;
      padding: 12px;
      display:inline-block;
      box-sizing: border-box;
      vertical-align: top;
    }

    .sidebar-list { list-style:none; padding:0; display:flex; flex-direction:column; gap:4px; margin:0; }
    .sidebar-list-item { display:block; }

    .chip { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:16px; border:1px solid rgba(255,255,255,0.25); color:var(--color-sidebar-text); background:rgba(255,255,255,0.08); cursor:pointer; font-size:0.8rem; line-height:1; user-select:none; transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease; }
    .chip:hover { background:rgba(255,255,255,0.14); }
    .chip.active, .chip[aria-pressed="true"], .chip[aria-checked="true"] {
      background:#fff;
      color:#23344d;
      border-color:#fff;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.06) inset, 0 1px 3px rgba(0,0,0,0.06);
    }
    .chip:not(.active):not([aria-pressed="true"]):not([aria-checked="true"]) { opacity:0.95; }
    .chip-badge { display:inline-flex; align-items:center; justify-content:center; width:30px; height:18px; border-radius:9px; font-size:0.7rem; font-weight:700; background:rgba(0,0,0,0.12); color:#fff; }
    .chip.active .chip-badge { background:#23344d; color:#fff; }
    .chip:focus-visible { outline:2px solid #5cc8ff; outline-offset:2px; }

    .sidebar-chip { padding:0 8px 0 0; border-radius:10px; background:transparent; border:1px solid rgba(0,0,0,0.06); box-sizing:border-box; min-height:25px; overflow:hidden; display:flex; align-items:center; }
    .sidebar-chip:hover, .sidebar-chip.chip-hover { background: rgba(255,255,255,0.18); cursor: pointer; }
    .sidebar-chip.active { background: transparent; border-color: transparent; background: rgb(55, 85, 130); }
    .sidebar-chip.active:hover { background: rgba(255,255,255,0.18); }
    .sidebar-chip .project-name-col, .sidebar-chip .team-name-col { padding-left:8px; font-weight:600; font-size:0.8rem; color:var(--color-sidebar-text); display:flex; align-items:center; }
    .sidebar-chip > span:first-child { display:inline-flex; width:22px; justify-content:center; align-items:center; }
    .chip-badge.small { font-size:0.75rem; min-width:20px; padding:0 6px; }
  `;

  constructor(){
    super();
    this.plugins = [];
    this.showDependencies = false;
  }

  connectedCallback(){
    super.connectedCallback();
    this._updatePlugins = () => {
      try{
        if (pluginManager && typeof pluginManager.list === 'function') {
          this.plugins = pluginManager.list();
        } else if (pluginManager && pluginManager.plugins instanceof Map) {
          this.plugins = [...pluginManager.plugins.values()].map(p => (typeof p.getMetadata === 'function' ? p.getMetadata() : p));
        } else {
          this.plugins = [];
        }
      } catch(e){
        console.warn('[ToolsMenu] failed to update plugins', e);
        this.plugins = [];
      }
      this.requestUpdate();
    };

    this._onDepsChanged = (val) => {
      try { this.showDependencies = !!val; } catch(e) { this.showDependencies = !!val; }
      this.requestUpdate();
    };

    bus.on(PluginEvents.REGISTERED, this._updatePlugins);
    bus.on(PluginEvents.UNREGISTERED, this._updatePlugins);
    bus.on(PluginEvents.ACTIVATED, this._updatePlugins);
    bus.on(PluginEvents.DEACTIVATED, this._updatePlugins);
    bus.on(ViewEvents.DEPENDENCIES, this._onDepsChanged);

    // initialize
    this._updatePlugins();
    // initialize dependencies state from global state
    try { this.showDependencies = !!state.showDependencies; } catch(e) { this.showDependencies = false; }
  }

  disconnectedCallback(){
    super.disconnectedCallback();
    if (this._updatePlugins) {
      bus.off(PluginEvents.REGISTERED, this._updatePlugins);
      bus.off(PluginEvents.UNREGISTERED, this._updatePlugins);
      bus.off(PluginEvents.ACTIVATED, this._updatePlugins);
      bus.off(PluginEvents.DEACTIVATED, this._updatePlugins);
    }
    if (this._onDepsChanged) bus.off(ViewEvents.DEPENDENCIES, this._onDepsChanged);
  }

  _toggleDependencies(e){
    e && e.stopPropagation();
    try{
      const newVal = !this.showDependencies;
      state.setShowDependencies(newVal);
      // optimistic update; ViewService will emit event which will reconcile
      this.showDependencies = newVal;
      this.requestUpdate();
    }catch(err){ console.warn('[ToolsMenu] toggle dependencies', err); }
  }

  _onPluginClick(e, p){
    e.stopPropagation();
    if (!p || !p.id) return;
    try{
      const isActive = pluginManager.isActive(p.id);
      const method = isActive ? 'deactivate' : 'activate';
      pluginManager[method](p.id).catch(console.warn);
    } catch(ex){ console.warn('[ToolsMenu] plugin click error', ex); }
  }

  render(){
    return html`
      <div class="menu-popover">
        <ul class="sidebar-list">
          <li class="sidebar-list-item">
            <div class="chip sidebar-chip ${this.showDependencies ? 'active' : ''}" role="button" tabindex="0" @click=${(e)=>this._toggleDependencies(e)} title="Toggle dependency links">
              <span style="display:inline-flex;width:22px;justify-content:center">${this.showDependencies ? '🔗' : '🔘'}</span>
              <div class="project-name-col">Dependencies</div>
            </div>
          </li>
          ${Array.isArray(this.plugins) && this.plugins.length > 0 ? this.plugins.map(p => {
            const isActive = pluginManager && typeof pluginManager.isActive === 'function' && pluginManager.isActive(p.id);
            return html`
            <li class="sidebar-list-item">
              <div class="chip sidebar-chip ${isActive ? 'active' : ''} ${p.disabled ? 'disabled' : ''}" role="button" tabindex="0" @click=${(e)=>{ if(!p.disabled) this._onPluginClick(e, p); }} title=${p.description || ''}>
                <span style="display:inline-flex;width:22px;justify-content:center">${isActive ? '🟢' : '⚪'}</span>
                <div class="project-name-col">${p.name || p.id}</div>
                ${p.version ? html`<div class="chip-badge small">${p.version}</div>` : ''}
              </div>
            </li>`;
          }) : html`<li style="padding:8px;color:var(--color-sidebar-text);opacity:0.8;">No tools available</li>`}
        </ul>
      </div>
    `;
  }
}

customElements.define('tools-menu', ToolsMenuLit);
