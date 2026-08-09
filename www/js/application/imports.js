import { featureFlags } from '../config.js';
import { store } from './store.js';
import { bus } from '../core/EventBus.js';
import { createUiCommands } from './commands/uiCommands.js';
import { createDataCommands } from './commands/dataCommands.js';
import { uiSelectors } from './selectors/uiSelectors.js';
import { dataService } from '../services/dataService.js';

const stateStoreCommands = {
  ui: createUiCommands(store, bus),
  data: createDataCommands(store, bus, dataService),
};
const stateStoreSelectors = {
  ui: uiSelectors,
};

// Keep the OFF branch explicit: state-store data commands are not exposed
// until a real legacy adapter is introduced for parity-safe cutover.
const legacyCommands = {
  ui: stateStoreCommands.ui,
};
const legacySelectors = stateStoreSelectors;

export const isStateStoreEnabled = featureFlags.USE_STATE_STORE === true;
export const cmd = isStateStoreEnabled ? stateStoreCommands : legacyCommands;
export const sel = isStateStoreEnabled ? stateStoreSelectors : legacySelectors;
