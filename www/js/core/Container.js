/**
 * Module: Container
 * Lightweight dependency-injection container used by the app.
 * Intent: provide a small, predictable API to register factories,
 * declare dependencies between services and resolve instances.
 * Features: constructor/factory-based creation, singleton caching
 * and simple circular-dependency detection.
 *
 * Internal data schemes:
 * @private
 * @typedef {Object} ServiceDef
 * @property {Function} factory - factory function or class constructor
 * @property {string[]} deps - ordered dependency names
 * @property {boolean} singleton - whether to cache instance
 *
 * @property {Map<string, ServiceDef>} services - registered factories
 * @property {Map<string, any>} singletons - cached singleton instances
 * @property {Set<string>} resolving - currently resolving service keys (for cycle detection)
 */
export class Container {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
    this.resolving = new Set();
  }
  
  /**
   * Register a service with its dependencies.
   * Purpose: declare how to construct a named service when requested.
   * @param {string} name - Unique service key used when resolving.
   * @param {Function} factory - Factory function or class constructor.
   *   Called with resolved dependency instances and must return the service instance.
   * @param {string[]} [deps=[]] - Ordered dependency names passed to the factory.
   * @param {boolean} [singleton=false] - When true, cache the created instance.
   * @returns {void}
   */
  register(name, factory, deps = [], singleton = false) {
    this.services.set(name, { factory, deps, singleton });
  }
  
  /**
   * Resolve a service by name.
   * Purpose: construct (or return cached) instance for `name` by
   * resolving its declared dependencies recursively and invoking the factory.
   * @param {string} name - Registered service key.
   * @returns {any} Resolved service instance.
   * @throws {Error} If service is not registered or a circular dependency is detected.
   */
  resolve(name) {
    if (this.singletons.has(name)) return this.singletons.get(name);

    const config = this.services.get(name);
    if (!config) throw new Error(`Service not registered: ${name}`);
    if (this.resolving.has(name)) throw new Error(`Circular dependency detected: ${name}`);

    this.resolving.add(name);
    try {
      const depInstances = config.deps.map(d => this.resolve(d));
      const instance = config.factory(...depInstances);
      if (config.singleton) this.singletons.set(name, instance);
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
    return [...this.services.keys()];
  }
}

// Global instance
export const container = new Container();
