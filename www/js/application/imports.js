import { store } from './store.js';
import { bus } from '../core/EventBus.js';
import { createUiCommands } from './commands/uiCommands.js';
import { createDataCommands } from './commands/dataCommands.js';
import { createSelectionCommands } from './commands/selectionCommands.js';
import { createFilterCommands } from './commands/filterCommands.js';
import { createViewCommands } from './commands/viewCommands.js';
import { createPluginStateCommands } from './commands/pluginStateCommands.js';
import { createPluginScenarioDataCommands } from './commands/pluginScenarioDataCommands.js';
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
import { createScopeSelectors } from './selectors/scopeSelectors.js';
import { dataService } from '../services/dataService.js';
import { DataEvents } from '../core/EventRegistry.js';

/** @typedef {import('./types.js').AppState} AppState */
/** @typedef {import('./types.js').StoreApi} StoreApi */

/**
 * @param {any[]|{scenarios?: any[]}|null|undefined} payload
 * @returns {void}
 */
function syncScenariosFromServer(payload) {
  const scenarios = Array.isArray(payload) ? payload : payload?.scenarios;
  if (!Array.isArray(scenarios)) return;

  store.setState(
    (state) => {
      const baseline = state.scenarios.items.find((scenario) => scenario.id === 'baseline') || {
        id: 'baseline',
        name: 'Baseline',
        readonly: true,
        overrides: {},
        groupOverrides: {},
        scenarioGroups: [],
        pluginData: {},
      };

      const normalizedBaseline = {
        ...baseline,
        id: 'baseline',
        name: baseline.name ?? 'Baseline',
        readonly: baseline.readonly ?? true,
        overrides: baseline.overrides ?? {},
        groupOverrides: baseline.groupOverrides ?? {},
        scenarioGroups: Array.isArray(baseline.scenarioGroups) ? baseline.scenarioGroups : [],
        // Every scenario item in the store always carries a pluginData bag
        // (createInitialAppState / cloneScenario / hydrate all default it).
        pluginData: baseline.pluginData,
      };

      const mergedServerScenarios = scenarios
        .filter((scenario) => scenario && typeof scenario === 'object' && scenario.id != null)
        .map((scenario) => {
          const existing = (Array.isArray(state.scenarios.items) ? state.scenarios.items : [])
            .find((item) => String(item.id) === String(scenario.id));
          const normalized = {
            ...(existing ?? {}),
            ...scenario,
            id: String(scenario.id),
            groupOverrides: scenario?.groupOverrides ?? existing?.groupOverrides ?? {},
            scenarioGroups: Array.isArray(scenario?.scenarioGroups)
              ? scenario.scenarioGroups
              : Array.isArray(existing?.scenarioGroups)
                ? existing.scenarioGroups
                : [],
            // The server normalizes every full scenario record (see
            // planner_lib/scenarios/scenario_store.py _normalize_scenario_data)
            // before returning it, so scenario.pluginData is always an object.
            pluginData: scenario.pluginData,
          };

          return normalized;
        });

      const localOnlyScenarios = (Array.isArray(state.scenarios.items) ? state.scenarios.items : [])
        .filter((scenario) => scenario && typeof scenario === 'object' && String(scenario.id) !== 'baseline')
        .filter((scenario) => !scenarios.some((serverScenario) => String(serverScenario.id) === String(scenario.id)));

      return {
        ...state,
        scenarios: {
          ...state.scenarios,
          items: [normalizedBaseline, ...localOnlyScenarios, ...mergedServerScenarios],
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

/** @type {any} */
const stateStoreCommands = {
  ui: createUiCommands(store, bus),
  data: createDataCommands(store, bus, dataService),
  selection: null,
  filter: null,
  view: createViewCommands(store, bus),
  pluginState: pluginStateCommands,
  pluginScenarioData: createPluginScenarioDataCommands(store, bus),
  viewRestore: createViewRestoreCommands(
    store,
    dataService,
    pluginStateCommands,
    () => stateStoreCommands.data.recomputeCapacity()
  ),
  feature: null,
  scenario: null,
  group: createGroupCommands(store, bus),
};
stateStoreCommands.selection = createSelectionCommands(
  store,
  bus
);
stateStoreCommands.filter = createFilterCommands(
  store,
  bus
);
stateStoreCommands.feature = createFeatureCommands(
  store,
  bus,
  () => stateStoreCommands.data.recomputeCapacity()
);
stateStoreCommands.scenario = createScenarioCommands(store, bus, {
  hydrateBaseline: () => stateStoreCommands.data.hydrateBaseline(),
  recomputeCapacity: () => stateStoreCommands.data.recomputeCapacity(),
  invalidateCache: () => dataService.invalidateCache(),
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
  scope: createScopeSelectors(store),
};

// The store-backed command/selector surface is now the only runtime surface.
export const isStateStoreEnabled = true;
export const cmd = stateStoreCommands;
export const sel = stateStoreSelectors;
