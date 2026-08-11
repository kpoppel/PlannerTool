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
import {
  createLegacyPluginStateCommands,
  createPluginStateCommands,
} from './commands/pluginStateCommands.js';
import {
  createLegacyViewRestoreCommands,
  createViewRestoreCommands,
} from './commands/viewRestoreCommands.js';
import {
  createLegacyFeatureCommands,
  createFeatureCommands,
} from './commands/featureCommands.js';
import {
  createLegacyScenarioCommands,
  createScenarioCommands,
} from './commands/scenarioCommands.js';
import { createLegacyGroupCommands, createGroupCommands } from './commands/groupCommands.js';
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
import {
  createLegacyFeatureSelectors,
  createFeatureSelectors,
} from './selectors/featureSelectors.js';
import { createLegacyCapacitySelectors, createCapacitySelectors } from './selectors/capacitySelectors.js';
import {
  createLegacyScenarioSelectors,
  createScenarioSelectors,
} from './selectors/scenarioSelectors.js';
import { createLegacyGroupSelectors, createGroupSelectors } from './selectors/groupSelectors.js';
import { dataService } from '../services/dataService.js';
import { groupService } from '../services/GroupService.js';

const stateStoreCommands = {
  ui: createUiCommands(store, bus),
  data: createDataCommands(store, bus, dataService, state),
  selection: createSelectionCommands(store, bus, () => stateStoreCommands.data.recomputeCapacity()),
  filter: createFilterCommands(store, bus, state, () => stateStoreCommands.data.recomputeCapacity()),
  view: createViewCommands(store, bus, state),
  viewRestore: createViewRestoreCommands(store, dataService, state),
  feature: createFeatureCommands(store, bus, state, () => stateStoreCommands.data.recomputeCapacity()),
  scenario: createScenarioCommands(store, bus, state),
  group: createGroupCommands(store, bus),
  pluginState: createPluginStateCommands(store),
};
const stateStoreSelectors = {
  ui: uiSelectors,
  selection: createSelectionSelectors(store, state),
  filter: createFilterSelectors(store, state),
  view: createViewSelectors(store, state),
  feature: createFeatureSelectors(store, state),
  scenario: createScenarioSelectors(store),
  group: createGroupSelectors(store),
  capacity: createCapacitySelectors(store),
};

// Keep the OFF branch explicit: state-store data commands are not exposed
// until a real legacy adapter is introduced for parity-safe cutover.
const legacyCommands = {
  ui: stateStoreCommands.ui,
  selection: createLegacySelectionCommands(state),
  filter: createLegacyFilterCommands(state),
  view: createLegacyViewCommands(state),
  viewRestore: createLegacyViewRestoreCommands(state),
  feature: createLegacyFeatureCommands(state),
  scenario: createLegacyScenarioCommands(state),
  group: createLegacyGroupCommands(state, groupService),
  pluginState: createLegacyPluginStateCommands(state),
};
const legacySelectors = {
  ui: uiSelectors,
  selection: createLegacySelectionSelectors(state),
  filter: createLegacyFilterSelectors(state),
  view: createLegacyViewSelectors(state),
  feature: createLegacyFeatureSelectors(state),
  scenario: createLegacyScenarioSelectors(state),
  group: createLegacyGroupSelectors(state, groupService),
  capacity: createLegacyCapacitySelectors(state),
};

export const isStateStoreEnabled = featureFlags.USE_STATE_STORE === true;
export const cmd = isStateStoreEnabled ? stateStoreCommands : legacyCommands;
export const sel = isStateStoreEnabled ? stateStoreSelectors : legacySelectors;
