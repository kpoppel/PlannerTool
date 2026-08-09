import { featureFlags } from '../config.js';
import { store } from './store.js';
import { bus } from '../core/EventBus.js';
import { state } from '../services/State.js';
import { createUiCommands } from './commands/uiCommands.js';
import { createDataCommands } from './commands/dataCommands.js';
import {
  createLegacySelectionCommands,
  createSelectionCommands,
} from './commands/selectionCommands.js';
import { createLegacyFilterCommands, createFilterCommands } from './commands/filterCommands.js';
import { createLegacyViewCommands, createViewCommands } from './commands/viewCommands.js';
import { uiSelectors } from './selectors/uiSelectors.js';
import {
  createLegacySelectionSelectors,
  createSelectionSelectors,
} from './selectors/selectionSelectors.js';
import {
  createLegacyFilterSelectors,
  createFilterSelectors,
} from './selectors/filterSelectors.js';
import { createLegacyViewSelectors, createViewSelectors } from './selectors/viewSelectors.js';
import { dataService } from '../services/dataService.js';

const stateStoreCommands = {
  ui: createUiCommands(store, bus),
  data: createDataCommands(store, bus, dataService),
  selection: createSelectionCommands(store, bus),
  filter: createFilterCommands(store, bus),
  view: createViewCommands(store, bus),
};
const stateStoreSelectors = {
  ui: uiSelectors,
  selection: createSelectionSelectors(store),
  filter: createFilterSelectors(store),
  view: createViewSelectors(store),
};

// Keep the OFF branch explicit: state-store data commands are not exposed
// until a real legacy adapter is introduced for parity-safe cutover.
const legacyCommands = {
  ui: stateStoreCommands.ui,
  selection: createLegacySelectionCommands(state),
  filter: createLegacyFilterCommands(state),
  view: createLegacyViewCommands(state),
};
const legacySelectors = {
  ui: uiSelectors,
  selection: createLegacySelectionSelectors(state),
  filter: createLegacyFilterSelectors(state),
  view: createLegacyViewSelectors(state),
};

export const isStateStoreEnabled = featureFlags.USE_STATE_STORE === true;
export const cmd = isStateStoreEnabled ? stateStoreCommands : legacyCommands;
export const sel = isStateStoreEnabled ? stateStoreSelectors : legacySelectors;
