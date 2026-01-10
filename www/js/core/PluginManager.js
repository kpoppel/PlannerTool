import { bus } from './EventBus.js';
import { PluginEvents } from './EventRegistry.js';

/**
 * Module: PluginManager
 * Intent: manage plugin lifecycle in the application.
 * Responsibilities:
 * - register/unregister plugins
 * - manage activation order (respecting dependencies)
 * - provide introspection (list/has/get)
 * Data schemes:
 * - `plugins`: Map<id, Plugin>
 * - `loadOrder`: Array<string>
 */
export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.loadOrder = [];
  }

  async register(plugin) {
    /**
     * Register a plugin instance.
     * @param {Plugin} plugin - plugin instance to register
     * @returns {Promise<void>}
     * @throws {Error} when plugin already registered or missing dependencies
     */
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin ${plugin.id} is already registered`);
    const missing = this._checkDependencies(plugin);
    if (missing.length) throw new Error(`Plugin ${plugin.id} missing dependencies: ${missing.join(', ')}`);

    this.plugins.set(plugin.id, plugin);
    await plugin.init();
    plugin.initialized = true;
    this._addToLoadOrder(plugin);
    bus.emit(PluginEvents.REGISTERED, { plugin: plugin.id });
  }

  /**
   * Unregister a plugin by id.
   * Purpose: remove plugin from manager after ensuring no other plugins depend on it.
   * @param {string} pluginId - plugin identifier
   * @returns {Promise<void>}
   * @throws {Error} when dependent plugins exist
   */
  async unregister(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    const dependents = this._findDependents(pluginId);
    if (dependents.length > 0) {
      throw new Error(`Cannot unregister plugin ${pluginId} required by: ${dependents.join(', ')}`);
    }

    // Ensure deactivated and destroyed
    if (plugin.active) {
      await this.deactivate(pluginId);
    }
    await plugin.destroy();
    this.plugins.delete(pluginId);
    this.loadOrder = this.loadOrder.filter(id => id !== pluginId);
    bus.emit(PluginEvents.UNREGISTERED, { plugin: pluginId });
  }
  
  /**
   * Activate a plugin and its dependencies.
   * @param {string} pluginId - plugin identifier to activate
   * @returns {Promise<void>}
   * @throws {Error} when plugin is not registered
   */
  async activate(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    if (!plugin.initialized) {
      await plugin.init();
      plugin.initialized = true;
    }
    
    if (plugin.active) {
      console.warn(`Plugin ${pluginId} is already active`);
      return;
    }

    // Determine dependency list for the target plugin (to avoid closing deps)
    const deps = plugin.getMetadata().dependencies || [];

    // Build a dependency set for this plugin (recursively)
    const depsSet = new Set();
    const collectDeps = (id) => {
      const p = this.plugins.get(id);
      if (!p) return;
      const dlist = p.getMetadata().dependencies || [];
      for (const d of dlist) {
        if (!depsSet.has(d)) {
          depsSet.add(d);
          collectDeps(d);
        }
      }
    };
    for (const d of deps) { depsSet.add(d); collectDeps(d); }

    // Decide shareability: a plugin may declare `config.exclusive = false` to
    // allow co-existence with other shareable plugins. Default is exclusive
    // (true) to preserve current single-open UX.
    const targetExclusive = !(plugin.config && plugin.config.exclusive === false);

    for (const other of this.plugins.values()) {
      if (other.id === pluginId) continue;
      if (!other.active) continue;
      // Never deactivate dependencies required by the target plugin
      if (depsSet.has(other.id)) continue;

      const otherExclusive = !(other.config && other.config.exclusive === false);

      // If both target and other are explicitly shareable (exclusive === false),
      // allow them to remain active together. Otherwise, deactivate the other
      // so the target may become active alone.
      const bothShareable = (targetExclusive === false && otherExclusive === false);
      if (bothShareable) continue;

      try {
        await this.deactivate(other.id);
      } catch (err) {
        console.warn(`[PluginManager] Failed to deactivate plugin ${other.id}:`, err);
      }
    }

    // Activate dependencies first (after ensuring incompatible actives were closed)
    for (const depId of deps) {
      if (!this.isActive(depId)) await this.activate(depId);
    }

    await plugin.activate();
    plugin.active = true;
    bus.emit(PluginEvents.ACTIVATED, { plugin: pluginId });
  }
  
  /**
   * Deactivate a plugin and any dependents that require it.
   * @param {string} pluginId - plugin identifier to deactivate
   * @returns {Promise<void>}
   * @throws {Error} when plugin is not registered
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
      if (this.isActive(depId)) await this.deactivate(depId);
    }

    await plugin.deactivate();
    plugin.active = false;
    bus.emit(PluginEvents.DEACTIVATED, { plugin: pluginId });
  }
  
  /**
   * Get a plugin by ID
   * @param {string} pluginId
   * @returns {Plugin|undefined}
   */
  get(pluginId) {
    return this.plugins.get(pluginId);
  }
  
  /**
   * Check if plugin is registered
   * @param {string} pluginId
   * @returns {boolean}
   */
  has(pluginId) {
    return this.plugins.has(pluginId);
  }
  
  /**
   * Check if plugin is active
   * @param {string} pluginId
   * @returns {boolean}
   */
  isActive(pluginId) {
    const plugin = this.plugins.get(pluginId);
    return !!(plugin && plugin.active);
  }
  
  /**
   * List all plugins
   * @returns {Array<object>} array of plugin metadata
   */
  list() {
    return [...this.plugins.values()].map(p => p.getMetadata());
  }
  
  /**
   * Load plugins from config
   * @param {{modules: Array<object>}} config
   * @returns {Promise<void>}
   */
  async loadFromConfig(config) {
    const modules = config.modules || [];
    
    // Sort by dependencies
    const sorted = this._topologicalSort(modules);

    for (const moduleConfig of sorted) {
      try {
        // If module is explicitly disabled, skip loading/registering it entirely
        if (moduleConfig.enabled === false) {
          console.log(`[PluginManager] Skipping disabled module ${moduleConfig.id}`);
          continue;
        }
        const module = await import(moduleConfig.path);
        // Expect the module to export a plugin class (constructor) which we instantiate.
        const exported = module[moduleConfig.export];
        if (typeof exported !== 'function') throw new Error('Unsupported plugin export type for ' + moduleConfig.id);

        const pluginInstance = new exported(moduleConfig.id, moduleConfig);
        await this.register(pluginInstance);

        // Use `activated` to control initial active state. This keeps `enabled` as a loader flag.
        if (moduleConfig.activated === true) {
          await this.activate(moduleConfig.id);
        }
      } catch (error) {
        console.error(`[PluginManager] Failed to load ${moduleConfig.id}:`, error);
      }
    }
  }
  
  // Private helpers
  
  _checkDependencies(plugin) {
    return (plugin.getMetadata().dependencies || []).filter(id => !this.plugins.has(id));
  }
  
  _findDependents(pluginId) {
    const dependents = [];
    for (const plugin of this.plugins.values()) {
      if ((plugin.getMetadata().dependencies || []).includes(pluginId)) dependents.push(plugin.id);
    }
    return dependents;
  }
  
  _addToLoadOrder(plugin) {
    const deps = plugin.getMetadata().dependencies || [];
    
    // Find position after all dependencies
    let insertIndex = 0;
    for (const depId of deps) {
      const depIndex = this.loadOrder.indexOf(depId);
      if (depIndex >= insertIndex) insertIndex = depIndex + 1;
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
