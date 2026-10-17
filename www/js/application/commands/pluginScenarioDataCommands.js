/**
 * pluginScenarioDataCommands.js
 * Generic, per-scenario storage for plugins — the scenario-scoped sibling of
 * `pluginStateCommands.js` (which is view-scoped). Together these two modules
 * are the one place in the code structure plugins should look for storage:
 *   - `cmd.pluginState`        — data tied to the active View (survives view save/restore)
 *   - `cmd.pluginScenarioData` — data tied to a Scenario (survives scenario save/clone,
 *                                so different scenarios can carry different plugin data)
 *
 * The scenario model stores this as an opaque `scenario.pluginData[key]` bag —
 * it never interprets what any plugin key means. Read-only scenario bags remain
 * available for inspection but cannot be changed by plugins.
 */
import { ScenarioEvents } from '../../core/EventRegistry.js';
import { getActiveScenarioId, getScenarioItems, getScenarioAccess } from '../shared/scenarioMutations.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */

function addScenarioToChangedIds(state, scenarioId) {
  const id = String(scenarioId);
  if (id === 'baseline') return state.scenarios.changedIds;
  return Array.from(new Set([...state.scenarios.changedIds, id]));
}

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @returns {object}
 */
export function createPluginScenarioDataCommands(store, bus) {
  return {
    /**
     * @param {string} [scenarioId] defaults to the active scenario
     * @param {string} [key] when omitted, returns the whole pluginData bag
     */
    get(scenarioId, key) {
      const state = store.getState();
      const id = scenarioId === undefined ? getActiveScenarioId(state) : scenarioId;
      const scenario = getScenarioItems(state).find((candidate) => candidate.id === id);
      if (!scenario) return key === undefined ? {} : undefined;
      return key === undefined ? scenario.pluginData : scenario.pluginData[key];
    },

    set(scenarioId, key, value) {
      const snapshot = store.getState();
      if (!getScenarioAccess(snapshot, scenarioId).canEdit) return null;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: addScenarioToChangedIds(state, scenarioId),
            items: getScenarioItems(state).map((scenario) => {
              if (scenario.id !== scenarioId) return scenario;
              const nextBag = { ...scenario.pluginData, [key]: value };
              return { ...scenario, pluginData: nextBag };
            }),
          },
        }),
        false,
        'pluginScenarioData.set'
      );

      bus.emit(ScenarioEvents.UPDATED);
      return value;
    },
  };
}
