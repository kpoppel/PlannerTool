/**
 * Service Registry
 * Central place to register all services with the DI Container
 * 
 * Phase 2: Register core services
 */
import { container } from './Container.js';
import { bus } from './EventBus.js';
import { featureFlags } from '../config.js';

/**
 * Register all core services with the container
 * Called at app startup
 */
export function registerCoreServices() {
  // EventBus (singleton, no deps)
  console.log('[ServiceRegistry] Registering DI Container');

  container.register(
    'EventBus',
    () => bus,
    [],
    true
  );
  
  // DataService (singleton, no deps)
  // Will be registered when dataService.js is converted in future phase
  
  // State (singleton, depends on EventBus and DataService)
  // Will be registered when state.js is converted in future phase
  
  console.log('[Container] Core services registered:', container.getRegisteredNames());
}

/**
 * Register service dynamically (used by plugins in future phases)
 * @param {string} name - Service name
 * @param {Function} factory - Factory function
 * @param {Array<string>} deps - Dependency names
 * @param {boolean} singleton - Whether to cache instance
 */
export function registerService(name, factory, deps = [], singleton = false) {
  if (container.has(name)) {
    console.warn(`[Container] Service already registered: ${name}`);
    return;
  }
  container.register(name, factory, deps, singleton);
  console.log(`[Container] Service registered: ${name}`);
}

/**
 * Get service instance from container
 * @param {string} name - Service name
 * @returns {any} Service instance
 */
export function getService(name) {
  try {
    return container.resolve(name);
  } catch (e) {
    console.error(`[Container] Failed to resolve: ${name}`, e);
    throw e;
  }
}
