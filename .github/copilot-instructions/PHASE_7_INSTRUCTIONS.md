# Phase 7: Plugin Manager - Copilot Instructions

**Goal:** Dynamic module loading with lifecycle management  
**Files:** Plugin.js, PluginManager.js, modules.config.json  
**Duration:** 3 days

---

## Quick Start

```bash
npm run test:watch -- --grep "Plugin"
```

---

## Step 1: Create Plugin Base Class (Day 1)

### File: `www/js/core/Plugin.js`

```javascript
/**
 * Base Plugin Class
 * All plugins extend this and implement lifecycle hooks
 */
export class Plugin {
  constructor(id, config = {}) {
    this.id = id;
    this.config = config;
    this.initialized = false;
    this.active = false;
  }
  
  /**
   * Initialize plugin (load resources, set up state)
   * Called once when plugin is registered
   */
  async init() {
    throw new Error(`Plugin ${this.id} must implement init()`);
  }
  
  /**
   * Activate plugin (start listening to events, render UI)
   * Called when plugin is enabled
   */
  async activate() {
    throw new Error(`Plugin ${this.id} must implement activate()`);
  }
  
  /**
   * Deactivate plugin (stop listeners, hide UI)
   * Called when plugin is disabled
   */
  async deactivate() {
    throw new Error(`Plugin ${this.id} must implement deactivate()`);
  }
  
  /**
   * Destroy plugin (clean up resources)
   * Called when plugin is unregistered
   */
  async destroy() {
    throw new Error(`Plugin ${this.id} must implement destroy()`);
  }
  
  /**
   * Get plugin metadata
   */
  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || this.id,
      version: this.config.version || '1.0.0',
      description: this.config.description || '',
      author: this.config.author || 'Unknown',
      dependencies: this.config.dependencies || []
    };
  }
}
```

---

## Step 2: Create Plugin Manager (Day 1)

### File: `www/js/core/PluginManager.js`

```javascript
import { bus } from '../eventBus.js';

/**
 * Plugin Manager
 * Manages plugin lifecycle and dependencies
 */
export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.loadOrder = [];
  }
  
  /**
  # Plugin System - Phase 7 Instructions

  This file defines the plugin API and config for Phase 7. Use the array-based `modules` config and the singleton `pluginManager`.

  ## Plugin base

  Create `www/js/core/Plugin.js` with a base `Plugin` class that exposes:

  - `constructor(id, config = {})` - store `id` and `config`.
  - `async init()` - perform setup; required.
  - `async activate()` - enable plugin behavior; required.
  - `async deactivate()` - disable plugin behavior; required.
  - `async destroy()` - cleanup resources; required.
  - `getMetadata()` - return metadata (id, name, version, dependencies).

  Throwing errors in unimplemented lifecycle methods is acceptable to force implementers to provide behavior.

  ## PluginManager

  Implement `www/js/core/PluginManager.js` as a singleton that supports:

  - `register(plugin)` - register a plugin instance and initialize it.
  - `unregister(pluginId)` - unregister and destroy plugin.
  - `activate(pluginId)` / `deactivate(pluginId)` - lifecycle operations that respect dependencies.
  - `get(pluginId)` / `has(pluginId)` / `isActive(pluginId)` / `list()` - inspection helpers.
  - `loadFromConfig(config)` - load modules from `modules.config.json`, import plugin modules dynamically, and register/activate based on `autoActivate`.

  Manager emits events on `eventBus`: `plugin:registered`, `plugin:activated`, `plugin:deactivated`, `plugin:unregistered`.

  ## Configuration

  Place config at `www/js/modules.config.json` using the array schema:

  ```json
  {
    "modules": [
      {
        "id": "main-graph",
        "name": "Main Graph",
        "version": "1.0.0",
        "path": "./plugins/MainGraphPlugin.js",
        "export": "MainGraphPlugin",
        "autoActivate": true,
        "dependencies": []
      }
    ]
  }
  ```

  This format simplifies dynamic imports: `const module = await import(moduleConfig.path)` then `new module[moduleConfig.export](moduleConfig.id, moduleConfig)`.

  ## Example plugin

  Create `www/js/plugins/SamplePlugin.js`:

  ```javascript
  import { Plugin } from '../core/Plugin.js';

  export class SamplePlugin extends Plugin {
    async init() {
      this.bus = window.eventBus;
    }
    async activate() {
      this.bus.on('feature:select', this.onFeatureSelect.bind(this));
    }
    async deactivate() {
      this.bus.off('feature:select', this.onFeatureSelect.bind(this));
    }
    async destroy() {
      // cleanup
    }
    onFeatureSelect(payload) {
      // handle selection
    }
  }
  ```

  ## Acceptance criteria

  - Implement `Plugin` base class in `www/js/core/Plugin.js`.
  - Implement `PluginManager` singleton in `www/js/core/PluginManager.js` with API listed above.
  - Add `www/js/modules.config.json` (array `modules` format) and ensure `loadFromConfig` can import and register plugins.
  - Add at least one example plugin and verify it loads and activates on app bootstrap.

  Follow the `pluginManager` API in the agent guide to keep consistency across docs.
    await plugin.activate();
    plugin.active = true;
    
    bus.emit('plugin:activated', { plugin: pluginId });
  }
  
  /**
   * Deactivate a plugin
   */
  async deactivate(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    if (!plugin.active) {
      console.warn(`Plugin ${pluginId} is already inactive`);
      return;
    }
    
    // Deactivate dependents first
    const dependents = this._findDependents(pluginId);
    for (const depId of dependents) {
      if (this.isActive(depId)) {
        await this.deactivate(depId);
      }
    }
    
    await plugin.deactivate();
    plugin.active = false;
    
    bus.emit('plugin:deactivated', { plugin: pluginId });
  }
  
  /**
   * Get a plugin by ID
   */
  get(pluginId) {
    return this.plugins.get(pluginId);
  }
  
  /**
   * Check if plugin is registered
   */
  has(pluginId) {
    return this.plugins.has(pluginId);
  }
  
  /**
   * Check if plugin is active
   */
  isActive(pluginId) {
    const plugin = this.plugins.get(pluginId);
    return plugin ? plugin.active : false;
  }
  
  /**
   * List all plugins
   */
  list() {
    return Array.from(this.plugins.values()).map(p => p.getMetadata());
  }
  
  /**
   * Load plugins from config
   */
  async loadFromConfig(config) {
    const modules = config.modules || [];
    
    // Sort by dependencies
    const sorted = this._topologicalSort(modules);
    
    for (const moduleConfig of sorted) {
      try {
        const module = await import(moduleConfig.path);
        const PluginClass = module[moduleConfig.export];
        const plugin = new PluginClass(moduleConfig.id, moduleConfig);
        
        await this.register(plugin);
        
        if (moduleConfig.autoActivate !== false) {
          await this.activate(moduleConfig.id);
        }
      } catch (error) {
        console.error(`[PluginManager] Failed to load ${moduleConfig.id}:`, error);
      }
    }
  }
  
  // Private helpers
  
  _checkDependencies(plugin) {
    const deps = plugin.getMetadata().dependencies;
    return deps.filter(depId => !this.plugins.has(depId));
  }
  
  _findDependents(pluginId) {
    const dependents = [];
    for (const plugin of this.plugins.values()) {
      const deps = plugin.getMetadata().dependencies;
      if (deps.includes(pluginId)) {
        dependents.push(plugin.id);
      }
    }
    return dependents;
  }
  
  _addToLoadOrder(plugin) {
    const deps = plugin.getMetadata().dependencies;
    
    // Find position after all dependencies
    let insertIndex = 0;
    for (const depId of deps) {
      const depIndex = this.loadOrder.indexOf(depId);
      if (depIndex >= insertIndex) {
        insertIndex = depIndex + 1;
      }
    }
    
    this.loadOrder.splice(insertIndex, 0, plugin.id);
  }
  
  _topologicalSort(modules) {
    // Simple topological sort by dependencies
    const sorted = [];
    const visited = new Set();
    
    function visit(module) {
      if (visited.has(module.id)) return;
      visited.add(module.id);
      
      const deps = module.dependencies || [];
      for (const depId of deps) {
        const depModule = modules.find(m => m.id === depId);
        if (depModule) visit(depModule);
      }
      
      sorted.push(module);
    }
    
    modules.forEach(visit);
    return sorted;
  }
}

// Singleton instance
export const pluginManager = new PluginManager();
```

---

## Step 3: Create Module Config (Day 1)

### File: `www/js/modules.config.json`

```json
{
  "modules": [
    {
      "id": "main-graph",
      "name": "Main Graph",
      "version": "1.0.0",
      "description": "Main feature graph visualization",
      "path": "./plugins/MainGraphPlugin.js",
      "export": "MainGraphPlugin",
      "autoActivate": true,
      "dependencies": []
    },
    {
      "id": "timeline",
      "name": "Timeline",
      "version": "1.0.0",
      "description": "Timeline view component",
      "path": "./plugins/TimelinePlugin.js",
      "export": "TimelinePlugin",
      "autoActivate": true,
      "dependencies": ["main-graph"]
    },
    {
      "id": "dependency-renderer",
      "name": "Dependency Renderer",
      "version": "1.0.0",
      "description": "Renders feature dependencies",
      "path": "./plugins/DependencyRendererPlugin.js",
      "export": "DependencyRendererPlugin",
      "autoActivate": true,
      "dependencies": ["main-graph"]
    },
    {
      "id": "details-panel",
      "name": "Details Panel",
      "version": "1.0.0",
      "description": "Feature details sidebar",
      "path": "./plugins/DetailsPanelPlugin.js",
      "export": "DetailsPanelPlugin",
      "autoActivate": true,
      "dependencies": []
    }
  ]
}
```

---

## Step 4: Create Example Plugin (Day 2)

### File: `www/js/plugins/MainGraphPlugin.js`

```javascript
import { Plugin } from '../core/Plugin.js';
import { bus } from '../eventBus.js';
import { state } from '../state.js';

export class MainGraphPlugin extends Plugin {
  constructor(id, config) {
    super(id, config);
    this.container = null;
    this.listeners = [];
  }
  
  async init() {
    console.log('[MainGraphPlugin] Initializing...');
    
    // Find container
    this.container = document.getElementById('main-graph');
    if (!this.container) {
      throw new Error('Main graph container not found');
    }
  }
  
  async activate() {
    console.log('[MainGraphPlugin] Activating...');
    
    // Render initial graph
    this.render();
    
    // Set up event listeners
    this.listeners = [
      bus.on('feature:added', () => this.render()),
      bus.on('feature:updated', () => this.render()),
      bus.on('feature:deleted', () => this.render()),
      bus.on('filter:applied', () => this.render())
    ];
  }
  
  async deactivate() {
    console.log('[MainGraphPlugin] Deactivating...');
    
    // Remove event listeners
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners = [];
    
    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
  
  async destroy() {
    console.log('[MainGraphPlugin] Destroying...');
    this.container = null;
  }
  
  render() {
    if (!this.container) return;
    
    const features = state.getFilteredFeatures();
    
    // Clear and render
    this.container.innerHTML = '';
    
    features.forEach(feature => {
      const card = document.createElement('div');
      card.className = 'feature-card';
      card.textContent = feature.title;
      card.onclick = () => bus.emit('details:show', feature);
      this.container.appendChild(card);
    });
  }
}
```

---

## Step 5: Write Tests (Day 2)

### File: `tests/core/test-plugin-manager.test.js`

```javascript
import { describe, it, beforeEach } from '@web/test-runner';
import { expect } from '@open-wc/testing';
import { PluginManager } from '../../www/js/core/PluginManager.js';
import { Plugin } from '../../www/js/core/Plugin.js';

class TestPlugin extends Plugin {
  async init() { this.initCalled = true; }
  async activate() { this.activateCalled = true; }
  async deactivate() { this.deactivateCalled = true; }
  async destroy() { this.destroyCalled = true; }
}

describe('PluginManager', () => {
  let manager;
  
  beforeEach(() => {
    manager = new PluginManager();
  });
  
  it('should register a plugin', async () => {
    const plugin = new TestPlugin('test-plugin');
    
    await manager.register(plugin);
    
    expect(manager.has('test-plugin')).to.be.true;
    expect(plugin.initialized).to.be.true;
  });
  
  it('should activate a plugin', async () => {
    const plugin = new TestPlugin('test-plugin');
    await manager.register(plugin);
    
    await manager.activate('test-plugin');
    
    expect(plugin.active).to.be.true;
    expect(plugin.activateCalled).to.be.true;
  });
  
  it('should deactivate a plugin', async () => {
    const plugin = new TestPlugin('test-plugin');
    await manager.register(plugin);
    await manager.activate('test-plugin');
    
    await manager.deactivate('test-plugin');
    
    expect(plugin.active).to.be.false;
    expect(plugin.deactivateCalled).to.be.true;
  });
  
  it('should unregister a plugin', async () => {
    const plugin = new TestPlugin('test-plugin');
    await manager.register(plugin);
    
    await manager.unregister('test-plugin');
    
    expect(manager.has('test-plugin')).to.be.false;
    expect(plugin.destroyCalled).to.be.true;
  });
  
  it('should check dependencies', async () => {
    const plugin = new TestPlugin('test-plugin', {
      dependencies: ['missing-plugin']
    });
    
    try {
      await manager.register(plugin);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error.message).to.include('missing dependencies');
    }
  });
  
  it('should prevent unregister if dependents exist', async () => {
    const plugin1 = new TestPlugin('plugin1');
    const plugin2 = new TestPlugin('plugin2', { dependencies: ['plugin1'] });
    
    await manager.register(plugin1);
    await manager.register(plugin2);
    
    try {
      await manager.unregister('plugin1');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error.message).to.include('required by');
    }
  });
  
  // Add 10 more tests...
});
```

**Run:** `npm test` → 20 new tests

---

## Step 6: Integrate with app.js (Day 3)

### File: `www/js/app.js` (MODIFY)

```javascript
import { pluginManager } from './core/PluginManager.js';
import modulesConfig from './modules.config.json' assert { type: 'json' };

async function init() {
  console.log('[App] Initializing...');
  
  // Load core modules
  await loadCoreModules();
  
  // Load plugins
  if (featureFlags.USE_PLUGIN_SYSTEM) {
    await pluginManager.loadFromConfig(modulesConfig);
    console.log('[App] Plugins loaded:', pluginManager.list());
  } else {
    // Legacy: load modules directly
    await import('./mainGraph.js');
    await import('./timeline.js');
    await import('./dependencyRenderer.js');
    await import('./detailsPanel.js');
  }
  
  console.log('[App] Initialization complete');
}

init().catch(error => {
  console.error('[App] Initialization failed:', error);
});
```

---

## Step 7: Manual Testing (Day 3)

### With Flag OFF (Legacy)
```javascript
featureFlags.USE_PLUGIN_SYSTEM = false;
```

1. Load app
2. Verify all modules load
3. Check console for no errors
4. Test all UI components work

### With Flag ON (Plugin System)
```javascript
featureFlags.USE_PLUGIN_SYSTEM = true;
```

1. Load app
2. Check console: `[PluginManager] Registered plugin: main-graph`
3. Open dev tools: `window.pluginManager.list()`
4. Deactivate plugin: `window.pluginManager.deactivate('timeline')`
5. Verify timeline disappears
6. Reactivate: `window.pluginManager.activate('timeline')`
7. Verify timeline reappears

---

## Acceptance Criteria

- [ ] Plugin.js base class created
- [ ] PluginManager.js created with full lifecycle
- [ ] modules.config.json created
- [ ] MainGraphPlugin example created
- [ ] 20 plugin tests passing
- [ ] 223 total tests passing (203 + 20)
- [ ] Plugins load dynamically
- [ ] Dependencies enforced
- [ ] Activation/deactivation works
- [ ] No console errors

---

## Next: Phase 8 - Lit Components
