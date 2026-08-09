/**
 * MountedPlugin - Base class for plugins that share common lifecycle boilerplate.
 *
 * Handles three duplicated patterns found across 10+ plugin entry files:
 * 1. Mount-point DOM resolution (`#${selector}` → `.${selector}` → `document.body`)
 * 2. Lazy component import + element creation + class/config assignment
 * 3. Element lifecycle (mount, show/hide via display property)
 *
 * Subclasses only need to provide:
 * - `componentTag`: the custom element name to create
 * - `componentPath`: the dynamic import path
 * - `isFullscreen` / `mountSelector` / config options
 * - any plugin-specific activate/deactivate extras (state save, bus.emit, etc.)
 */
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

/**
 * Static module loader map for plugin components.
 *
 * Why explicit entries instead of import.meta.glob:
 * - Uvicorn dev deployment serves native ES modules directly where `import.meta.glob`
 *   is not available (it is Vite-only syntax).
 * - Literal dynamic imports remain compatible with both native browser ESM and
 *   Vite production builds (Vite rewrites the chunk URLs during build).
 */
const pluginComponentLoaders = {
  './PluginAnnotationsComponent.js': () => import('./PluginAnnotationsComponent.js'),
  './PluginCostComponent.js': () => import('./PluginCostComponent.js'),
  './PluginDependenciesComponent.js': () => import('./PluginDependenciesComponent.js'),
  './PluginEventsComponent.js': () => import('./PluginEventsComponent.js'),
  './PluginExportTimelineComponent.js': () => import('./PluginExportTimelineComponent.js'),
  './PluginGraphComponent.js': () => import('./PluginGraphComponent.js'),
  './PluginHistoryComponent.js': () => import('./PluginHistoryComponent.js'),
  './PluginLinkEditorComponent.js': () => import('./PluginLinkEditorComponent.js'),
  './PluginMarkersComponent.js': () => import('./PluginMarkersComponent.js'),
  './PluginPlanHealthComponent.js': () => import('./PluginPlanHealthComponent.js'),
  './PluginPortfolioComponent.lit.js': () => import('./PluginPortfolioComponent.lit.js'),
  './PluginXYBoardComponent.lit.js': () => import('./PluginXYBoardComponent.lit.js'),
  './SamplePluginComponent.lit.js': () => import('./SamplePluginComponent.lit.js'),
};

/**
 * Resolve a plugin component module loader from a static module map.
 * This keeps dynamic plugin component loading compatible with Vite hashed chunks.
 *
 * @param {string} componentPath
 * @param {Record<string, () => Promise<unknown>>} [moduleMap]
 * @returns {(() => Promise<unknown>)|null}
 */
export function resolvePluginComponentLoader(componentPath, moduleMap = pluginComponentLoaders) {
  if (!componentPath) return null;
  return moduleMap[componentPath] || null;
}

export class MountedPlugin {
  constructor(id, config = {}) {
    this.id = id;
    this.config = config;
    /** @type {HTMLElement|null} */
    this._el = null;
    /** @type {Element|null} */
    this._host = null;
    /** @type {boolean} */
    this._componentLoaded = false;
    /** @type {boolean} */
    this.initialized = false;
    /** @type {boolean} */
    this.active = false;

    // Defaults — can be overridden by config or subclass getter
    this._mountSelector = config.mountPoint || this.mountSelector || 'app';
  }

  /** Default mount selector (overridden in subclasses if different). */
  get mountSelector() { return 'app'; }

  /* ── mount-point resolution (Pattern 1) ─────────────────────────────── */

  /**
   * Resolve the host element for this plugin using the standard fallback:
   * `#${selector}` → `.${selector}` → `document.body`.
   * Cached on first call so subsequent activates avoid repeated DOM queries.
   */
  _resolveHost() {
    if (this._host) return;
    const sel = this._mountSelector;
    this._host =
      document.querySelector(`#${sel}`) ||
      document.querySelector(`.${sel}`) ||
      document.body;
  }

  /* ── lazy component import + element creation (Pattern 3) ───────────── */

  /** Override in subclass to return the ES module path for the component. */
  get componentPath() { return ''; }

  /** Override in subclass to return the custom element tag name. */
  get componentTag() { return ''; }

  async _ensureComponent() {
    if (!this._componentLoaded && this.componentPath) {
      const loadComponent = resolvePluginComponentLoader(this.componentPath);
      if (!loadComponent) {
        throw new Error(`MountedPlugin could not resolve component module: ${this.componentPath}`);
      }
      await loadComponent();
      this._componentLoaded = true;
    }
  }

  /**
   * Ensure the plugin element exists in the DOM.
   * Subclasses can override to add extra configuration on `_el`.
   */
  async _ensureElement() {
    if (this._el) return;
    this._resolveHost();
    this._el = document.createElement(this.componentTag);
    this._el.classList.add('main');
    this._el.style.display = 'none'; // Start hidden
    this._host.appendChild(this._el);
  }

  /* ── lifecycle (default impl; subclasses extend via `super`) ────────── */

  async init() {
    await this._ensureComponent();
    this._resolveHost();
    this.initialized = true;
  }

  async activate() {
    await this._ensureComponent();
    await this._ensureElement();
    this._showPlugin();
    this.active = true;
    bus.emit(PluginEvents.ACTIVATED, { id: this.id });
  }

  async deactivate() {
    this._hidePlugin();
    if (this._el && typeof this._el.close === 'function') this._el.close();
    this.active = false;
    bus.emit(PluginEvents.DEACTIVATED, { id: this.id });
  }

  async destroy() {
    this._el?.remove();
    this._el = null;
    this.initialized = false;
    this.active = false;
  }

  toggle() {
    this.active ? this.deactivate() : this.activate();
  }

  /* ── show / hide (Pattern 2 is a FullscreenPlugin concern) ──────────── */

  _showPlugin() {
    if (this._el) this._el.style.display = 'flex';
  }

  _hidePlugin() {
    if (this._el) this._el.style.display = 'none';
  }
}
