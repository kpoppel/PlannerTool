import { createStore, subscribeWithSelector, devtools } from '../vendor/zustand.js';
import { createInitialAppState } from './createInitialAppState.js';

export const store = createStore(
  subscribeWithSelector(
    devtools(() => createInitialAppState(), {
      name: 'PlannerStore',
    })
  )
);
