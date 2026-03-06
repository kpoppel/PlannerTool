import { PopoverBase } from './PopoverBase.lit.js';
import { html, css } from '../../vendor/lit.js';
import { bus } from '../../core/EventBus.js';
import { PluginEvents } from '../../core/EventRegistry.js';
import { pluginManager } from '../../core/PluginManager.js';

/**
 * ToolsPopover - Popover component for tools and plugins
 */
export class ToolsPopover extends PopoverBase {
  static properties = {
    ...PopoverBase.properties,
    plugins: { type: Array },
    activePluginId: { type: String }
  };

  static styles = [
    PopoverBase.styles,
    css`
      :host {
        color: #222;
      }

      .popover-container {
        background: #fff !important;
        color: #222 !important;
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 6px 18px rgba(0,0,0,0.18);
      }

      .tool-item {
        display: flex;
        align-items: center;
        padding: 4px 4px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.2s;
        gap: 8px;
        margin: 0 4px;
        color: #222 !important;
      }

      .tool-item:hover {
        background: #f3f5f7;
      }

      .tool-item.active {
        background: #e8f0fe;
        font-weight: 600;
      }

      .tool-name {
        flex: 1;
        color: #222 !important;
      }

      .empty-state {
        padding: 16px;
        text-align: center;
        color: #666;
        font-size: 13px;
      }
    `
  ];

  constructor() {
    super();
    this.plugins = [];
    this.activePluginId = null;
    this._onPluginRegistered = this._onPluginRegistered.bind(this);
    this._onPluginActivated = this._onPluginActivated.bind(this);
    this._onPluginDeactivated = this._onPluginDeactivated.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    bus.on(PluginEvents.REGISTERED, this._onPluginRegistered);
    bus.on(PluginEvents.ACTIVATED, this._onPluginActivated);
    bus.on(PluginEvents.DEACTIVATED, this._onPluginDeactivated);
    this._loadPlugins();
  }

  disconnectedCallback() {
    bus.off(PluginEvents.REGISTERED, this._onPluginRegistered);
    bus.off(PluginEvents.ACTIVATED, this._onPluginActivated);
    bus.off(PluginEvents.DEACTIVATED, this._onPluginDeactivated);
    super.disconnectedCallback();
  }

  _onPluginRegistered() {
    this._loadPlugins();
  }

  _onPluginActivated(data) {
    this.activePluginId = data.id || null;
    this.requestUpdate();
  }

  _onPluginDeactivated() {
    this.activePluginId = null;
    this.requestUpdate();
  }

  _loadPlugins() {
    try {
      let regs = [];
      if (pluginManager && typeof pluginManager.list === 'function') {
        regs = pluginManager.list();
      } else if (pluginManager && pluginManager.plugins instanceof Map) {
        regs = [...pluginManager.plugins.values()].map(p =>
          typeof p.getMetadata === 'function' ? p.getMetadata() : p
        );
      }
      this.plugins = Array.isArray(regs) ? regs : [];
      
      // Check if a plugin is currently active
      if (pluginManager && typeof pluginManager.getActivePlugin === 'function') {
        const activePlugin = pluginManager.getActivePlugin();
        this.activePluginId = activePlugin?.id || null;
      }
      
      this.requestUpdate();
    } catch (err) {
      console.error('Failed to load plugins:', err);
      this.plugins = [];
    }
  }

  _onPluginClick(plugin) {
    try {
      if (pluginManager && typeof pluginManager.isActive === 'function') {
        const isActive = pluginManager.isActive(plugin.id);
        
        if (isActive) {
          // Deactivate if already active
          if (typeof pluginManager.deactivate === 'function') {
            pluginManager.deactivate(plugin.id);
          }
        } else {
          // Activate the plugin
          if (typeof pluginManager.activate === 'function') {
            pluginManager.activate(plugin.id);
          }
        }
      }
      this.close();
    } catch (err) {
      console.error('Failed to toggle plugin:', err);
    }
  }

  renderContent() {
    if (!this.plugins || this.plugins.length === 0) {
      return html`
        <div class="empty-state">
          No plugins available
        </div>
      `;
    }

    return html`
      <div class="tools-list">
        ${this.plugins.map(
          plugin => html`
            <div
              class="tool-item ${plugin.id === this.activePluginId || (pluginManager && pluginManager.isActive && pluginManager.isActive(plugin.id)) ? 'active' : ''}"
              @click=${() => this._onPluginClick(plugin)}>
              <span class="tool-name">${plugin.name || plugin.id}</span>
            </div>
          `
        )}
      </div>
    `;
  }
}

customElements.define('tools-popover', ToolsPopover);
