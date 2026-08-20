import { createStore, subscribeWithSelector, devtools } from '../vendor/zustand.js';
import { createInitialAppState } from './createInitialAppState.js';

/** @typedef {import('./types.js').AppState} AppState */
/** @typedef {import('./types.js').StoreApi} StoreApi */

export const store = /** @type {StoreApi} */ (
  createStore(
    subscribeWithSelector(
      devtools(() => createInitialAppState(), {
        name: 'PlannerStore',
      })
    )
  )
);

/**
 * @param {AppState} [state]
 * @returns {boolean}
 */
export function isStoreReady(state = store.getState()) {
  const baseline = state?.baseline || {};
  const lifecycle = state?.lifecycle || {};
  return lifecycle.status === 'ready'
    && Array.isArray(baseline.projects)
    && Array.isArray(baseline.teams)
    && Array.isArray(baseline.features);
}

/**
 * @returns {AppState|null}
 */
export function readStoreWhenReady() {
  return isStoreReady() ? store.getState() : null;
}
