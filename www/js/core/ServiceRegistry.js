/**
 * Module: ServiceRegistry
 * Intent: central registration point for core services into the DI
 * container. Plugins may call `registerService` to register additional
 * services at runtime.
 * Data schemes:
 * - container: instance of `Container` that stores registered service
 *   definitions as Map<name, {factory,deps,singleton}>
 */
import { container } from './Container.js';
import { bus } from './EventBus.js';
import { featureFlags } from '../config.js';

/**
 * Register all core services with the container.
 * Purpose: called during app startup to register mandatory core services.
 * Effects: registers `EventBus` as a singleton service under the name
 * `EventBus` so consumers can request it from the container by name.
 */
export function registerCoreServices() {
  // EventBus (singleton, no deps)
  container.register('EventBus', () => bus, [], true);

  // DataService / State registration placeholders remain until those
  // modules are converted to the DI pattern.

  console.log('[ServiceRegistry] Core services registered:', container.getRegisteredNames());
}

/**
 * Register service dynamically (used by plugins in future phases)
 * @param {string} name - Service name
 * @param {Function} factory - Factory function
 * @param {Array<string>} [deps=[]] - Dependency names
 * @param {boolean} [singleton=false] - Whether to cache instance
 * @returns {void}
 */
export function registerService(name, factory, deps = [], singleton = false) {
  if (container.has(name)) {
    console.warn(`[ServiceRegistry] Service already registered: ${name}`);
    return;
  }
  container.register(name, factory, deps, singleton);
  console.log(`[ServiceRegistry] Service registered: ${name}`);
}

/**
 * Get service instance from container
 * @param {string} name - Service name
 * @returns {any} Service instance
 * @throws {Error} When resolution fails
 */
export function getService(name) {
  try {
    return container.resolve(name);
  } catch (e) {
    console.error(`[ServiceRegistry] Failed to resolve: ${name}`, e);
    throw e;
  }
}
