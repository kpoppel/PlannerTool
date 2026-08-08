import { featureFlags } from '../config.js';
import { store } from './store.js';
import { bus } from '../core/EventBus.js';
import { createUiCommands } from './commands/uiCommands.js';
import { uiSelectors } from './selectors/uiSelectors.js';

const stateStoreCommands = {
  ui: createUiCommands(store, bus),
};
const stateStoreSelectors = {
  ui: uiSelectors,
};

// Phase 1 only seeds the seam; real State.js adapters are introduced in later phases.
const legacyCommands = stateStoreCommands;
const legacySelectors = stateStoreSelectors;

export const isStateStoreEnabled = featureFlags.USE_STATE_STORE === true;
export const cmd = isStateStoreEnabled ? stateStoreCommands : legacyCommands;
export const sel = isStateStoreEnabled ? stateStoreSelectors : legacySelectors;
