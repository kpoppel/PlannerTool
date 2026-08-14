import { createStore, subscribeWithSelector, devtools } from '../vendor/zustand.js';
import { createInitialAppState } from './createInitialAppState.js';

export const store = createStore(
  subscribeWithSelector(
    devtools(() => createInitialAppState(), {
      name: 'PlannerStore',
    })
  )
);

export function isStoreReady(state = store.getState()) {
  const baseline = state?.baseline || {};
  const lifecycle = state?.lifecycle || {};
  return lifecycle.status === 'ready'
    && Array.isArray(baseline.projects)
    && Array.isArray(baseline.teams)
    && Array.isArray(baseline.features);
}

export function readStoreWhenReady() {
  return isStoreReady() ? store.getState() : null;
}
