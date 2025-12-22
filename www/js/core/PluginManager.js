import { bus } from './EventBus.js';
import { PluginEvents } from './EventRegistry.js';

export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.loadOrder = [];
  }

  async register(plugin) {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin ${plugin.id} is already registered`);
    }

    const missing = this._checkDependencies(plugin);
    if (missing.length > 0) {
      throw new Error(`Plugin ${plugin.id} missing dependencies: ${missing.join(', ')}`);
    }

    this.plugins.set(plugin.id, plugin);

    await plugin.init();
    plugin.initialized = true;

    this._addToLoadOrder(plugin);
    bus.emit(PluginEvents.REGISTERED, { plugin: plugin.id });
  }

  /**
   * Unregister a plugin
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
   * Activate a plugin
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
    
    // Activate dependencies first
    const deps = plugin.getMetadata().dependencies;
    for (const depId of deps) {
      if (!this.isActive(depId)) {
        await this.activate(depId);
      }
    }
    
    await plugin.activate();
    plugin.active = true;
    
    bus.emit(PluginEvents.ACTIVATED, { plugin: pluginId });
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
    
    bus.emit(PluginEvents.DEACTIVATED, { plugin: pluginId });
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
