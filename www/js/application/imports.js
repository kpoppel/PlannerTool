import { store } from './store.js';
import { bus } from '../core/EventBus.js';
import { createUiCommands } from './commands/uiCommands.js';
import { createDataCommands } from './commands/dataCommands.js';
import { createSelectionCommands } from './commands/selectionCommands.js';
import { createFilterCommands } from './commands/filterCommands.js';
import { createViewCommands } from './commands/viewCommands.js';
import { createPluginStateCommands } from './commands/pluginStateCommands.js';
import { createViewRestoreCommands } from './commands/viewRestoreCommands.js';
import { createFeatureCommands } from './commands/featureCommands.js';
import { createScenarioCommands } from './commands/scenarioCommands.js';
import { createGroupCommands } from './commands/groupCommands.js';
import { uiSelectors } from './selectors/uiSelectors.js';
import { createSelectionSelectors } from './selectors/selectionSelectors.js';
import { createFilterSelectors } from './selectors/filterSelectors.js';
import { createViewSelectors } from './selectors/viewSelectors.js';
import { createFeatureSelectors } from './selectors/featureSelectors.js';
import { createCapacitySelectors } from './selectors/capacitySelectors.js';
import { createScenarioSelectors } from './selectors/scenarioSelectors.js';
import { createGroupSelectors } from './selectors/groupSelectors.js';
import { dataService } from '../services/dataService.js';
import { DataEvents } from '../core/EventRegistry.js';

function syncScenariosFromServer(payload) {
  const scenarios = Array.isArray(payload) ? payload : Array.isArray(payload?.scenarios) ? payload.scenarios : null;
  if (!Array.isArray(scenarios)) return;

  // Merge metadata-only updates without discarding already-loaded nested payloads.
  // Full payloads replace the stored nested objects because the key is present.
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

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
              overrides: hasOwn(scenario, 'overrides') ? scenario.overrides ?? {} : existing?.overrides ?? {},
              filters: hasOwn(scenario, 'filters') ? scenario.filters ?? {} : existing?.filters ?? {},
              view: hasOwn(scenario, 'view') ? scenario.view ?? {} : existing?.view ?? {},
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
  recomputeCapacity: (...args) => stateStoreCommands.data.recomputeCapacity(...args),
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

// The store-backed command/selector surface is now the only runtime surface.
export const isStateStoreEnabled = true;
export const cmd = stateStoreCommands;
export const sel = stateStoreSelectors;
