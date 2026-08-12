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
import { DataEvents } from '../core/EventRegistry.js';

function syncScenariosFromServer(payload) {
  const scenarios = Array.isArray(payload) ? payload : Array.isArray(payload?.scenarios) ? payload.scenarios : null;
  if (!Array.isArray(scenarios)) return;

  store.setState(
    (state) => {
      const baseline =
        (state.scenarios?.items || []).find((scenario) => scenario.id === 'baseline') ||
        { id: 'baseline', name: 'Baseline', overrides: {} };
      const existingById = new Map(
        (state.scenarios?.items || [])
          .filter((scenario) => scenario?.id && scenario.id !== 'baseline')
          .map((scenario) => [String(scenario.id), scenario])
      );

      const nextItems = [
        baseline,
        ...scenarios
          .filter((scenario) => scenario?.id !== 'baseline')
          .map((scenario) => {
            const existing = existingById.get(String(scenario.id));
            const merged = {
              ...existing,
              ...scenario,
              overrides: existing?.overrides ?? scenario?.overrides ?? {},
              filters: existing?.filters ?? scenario?.filters ?? {},
              view: existing?.view ?? scenario?.view ?? {},
              isChanged: false,
            };
            return merged;
          }),
      ];

      return {
        ...state,
        scenarios: {
          ...state.scenarios,
          items: nextItems,
        },
      };
    },
    false,
    'scenario.syncScenariosFromServer'
  );
}

bus.on(DataEvents.SCENARIOS_CHANGED, syncScenariosFromServer);
bus.on(DataEvents.SCENARIOS_DATA, syncScenariosFromServer);

const pluginStateCommands = createPluginStateCommands(store);

const stateStoreCommands = {
  ui: createUiCommands(store, bus),
  data: createDataCommands(store, bus, dataService),
  selection: null,
  filter: null,
  view: createViewCommands(store, bus),
  pluginState: pluginStateCommands,
  viewRestore: createViewRestoreCommands(store, dataService, pluginStateCommands),
  feature: null,
  scenario: null,
  group: createGroupCommands(store, bus),
};
stateStoreCommands.selection = createSelectionCommands(
  store,
  bus,
  () => stateStoreCommands.data.recomputeCapacity()
);
stateStoreCommands.filter = createFilterCommands(
  store,
  bus,
  () => stateStoreCommands.data.recomputeCapacity()
);
stateStoreCommands.feature = createFeatureCommands(
  store,
  bus,
  () => stateStoreCommands.data.recomputeCapacity()
);
stateStoreCommands.scenario = createScenarioCommands(store, bus, null, {
  hydrateBaseline: (...args) => stateStoreCommands.data.hydrateBaseline(...args),
  hydrateScenarioData: (...args) => stateStoreCommands.data.hydrateScenarioData(...args),
  invalidateCache: (...args) => dataService.invalidateCache(...args),
});
const stateStoreSelectors = {
  ui: uiSelectors,
  selection: createSelectionSelectors(store),
  filter: createFilterSelectors(store),
  view: createViewSelectors(store),
  feature: createFeatureSelectors(store),
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
