import { AppStore } from './AppStore.js';
import { createInitialAppState } from './createInitialAppState.js';

function asObject(value, name) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must return an object`);
  }
  return value;
}

function callLifecycle(target, method, context) {
  if (typeof target?.[method] !== 'function') return undefined;
  return target[method](context);
}

/**
 * Compose one Planner application instance.
 *
 * This is the only supported location for application-wide dependency wiring.
 * Factories receive narrow, explicit dependencies instead of importing global
 * singletons. It is introduced alongside the legacy State facade so domains
 * can migrate incrementally without changing UI behavior.
 *
 * Runtime invariants:
 * - Canonical mutable runtime truth is the AppStore instance.
 * - Writes happen through labeled transactions (`store.update`).
 * - Selectors are pure reads over store snapshots.
 * - Services may compute/perform IO but must not directly mutate AppStore snapshots.
 *
 * @param {{
 *   eventBus?: object,
 *   initialState?: object,
 *   adapters?: object,
 *   gateways?: object,
 *   createServices?: (context: object) => object,
 *   createSelectors?: (context: object) => object,
 *   createCommands?: (context: object) => object,
 * }} [options]
 */
export function createPlannerApplication(options = {}) {
  const store = new AppStore(options.initialState || createInitialAppState());
  const runtime = Object.freeze({
    store,
    eventBus: options.eventBus || null,
    adapters: Object.freeze({ ...(options.adapters || {}) }),
    gateways: Object.freeze({ ...(options.gateways || {}) }),
  });

  const services = asObject(options.createServices?.(runtime), 'createServices');
  const selectors = asObject(
    options.createSelectors?.({ ...runtime, services }),
    'createSelectors'
  );
  const commands = asObject(
    options.createCommands?.({ ...runtime, services, selectors }),
    'createCommands'
  );

  let initializePromise = null;
  let initialized = false;
  let destroyed = false;

  const application = {
    store,
    eventBus: runtime.eventBus,
    adapters: runtime.adapters,
    gateways: runtime.gateways,
    services: Object.freeze(services),
    selectors: Object.freeze(selectors),
    commands: Object.freeze(commands),

    get initialized() {
      return initialized;
    },

    getState() {
      return store.getState();
    },

    async initialize() {
      if (destroyed) throw new Error('Cannot initialize a destroyed Planner application');
      if (initialized) return application;
      if (initializePromise) return initializePromise;

      store.update('application.initialize', (draft) => {
        draft.lifecycle.status = 'loading';
        draft.lifecycle.error = null;
      });

      const lifecycleContext = Object.freeze({
        ...runtime,
        services: application.services,
        selectors: application.selectors,
        commands: application.commands,
      });

      initializePromise = (async () => {
        try {
          await callLifecycle(application.services, 'initialize', lifecycleContext);
          await callLifecycle(application.commands, 'initialize', lifecycleContext);
          initialized = true;
          store.update('application.ready', (draft) => {
            draft.lifecycle.status = 'ready';
          });
          return application;
        } catch (error) {
          store.update('application.failed', (draft) => {
            draft.lifecycle.status = 'failed';
            draft.lifecycle.error = error instanceof Error ? error.message : String(error);
          });
          initializePromise = null;
          throw error;
        }
      })();

      return initializePromise;
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      const lifecycleContext = Object.freeze({
        ...runtime,
        services: application.services,
        selectors: application.selectors,
        commands: application.commands,
      });
      await callLifecycle(application.commands, 'destroy', lifecycleContext);
      await callLifecycle(application.services, 'destroy', lifecycleContext);
      store.destroy();
    },
  };

  return Object.freeze(application);
}
