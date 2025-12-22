/**
 * Lightweight DI Container
 * Supports constructor injection, singletons, and circular dependency detection
 * 
 * Phase 2: Core infrastructure for dependency injection
 */
export class Container {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
    this.resolving = new Set();
  }
  
  /**
   * Register a service with its dependencies
   * @param {string} name - Service name
   * @param {Function} factory - Factory function or class constructor
   * @param {Array<string>} deps - Dependency names
   * @param {boolean} singleton - Cache instance
   */
  register(name, factory, deps = [], singleton = false) {
    this.services.set(name, { factory, deps, singleton });
  }
  
  /**
   * Resolve a service by name
   * @param {string} name - Service name
   * @returns {any} Service instance
   */
  resolve(name) {
    // Check singleton cache
    if (this.singletons.has(name)) {
      return this.singletons.get(name);
    }
    
    // Get service config
    const config = this.services.get(name);
    if (!config) {
      throw new Error(`Service not registered: ${name}`);
    }
    
    // Circular dependency check
    if (this.resolving.has(name)) {
      throw new Error(`Circular dependency detected: ${name}`);
    }
    
    this.resolving.add(name);
    
    try {
      // Resolve dependencies
      const depInstances = config.deps.map(dep => this.resolve(dep));
      
      // Create instance
      const instance = config.factory(...depInstances);
      
      // Cache if singleton
      if (config.singleton) {
        this.singletons.set(name, instance);
      }
      
      return instance;
    } finally {
      this.resolving.delete(name);
    }
  }
  
  /**
   * Check if service is registered
   * @param {string} name - Service name
   * @returns {boolean}
   */
  has(name) {
    return this.services.has(name);
  }
  
  /**
   * Reset container (for testing)
   */
  reset() {
    this.services.clear();
    this.singletons.clear();
    this.resolving.clear();
  }
  
  /**
   * Get all registered service names
   * @returns {Array<string>}
   */
  getRegisteredNames() {
    return Array.from(this.services.keys());
  }
}

// Global instance
export const container = new Container();
