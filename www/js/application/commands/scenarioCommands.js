import { CapacityEvents, FeatureEvents, GroupEvents, ScenarioEvents } from '../../core/EventRegistry.js';
import { dataService } from '../../services/dataService.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */
/** @typedef {import('../types.js').AppState} AppState */
/** @typedef {import('../types.js').ScenarioItem} ScenarioItem */

function cloneValue(value) {
  if (value == null) return {};
  return structuredClone(value);
}

function createScenarioId() {
  return `scen_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function createDefaultScenarioName(existingScenarios) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const re = /^\d{2}-\d{2} Scenario (\d+)$/i;
  let maxN = 0;

  for (const scenario of existingScenarios) {
    const match = re.exec(scenario?.name || '');
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > maxN) {
      maxN = value;
    }
  }

  return `${mm}-${dd} Scenario ${maxN + 1}`;
}

function ensureUniqueScenarioName(baseName, existingScenarios) {
  const seenNames = new Set(
    existingScenarios
      .map((scenario) => (scenario?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  let candidate = baseName;
  let suffix = 2;
  while (seenNames.has(candidate.trim().toLowerCase())) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function emitScenarioList(bus, scenarios, activeScenarioId) {
  void scenarios;
  void activeScenarioId;
  bus?.emit?.(ScenarioEvents.LIST);
}

function toScenarioItems(storeState) {
  return Array.isArray(storeState?.scenarios?.items) ? storeState.scenarios.items : [];
}

function toChangedIds(storeState) {
  return storeState.scenarios.changedIds.map(String);
}

function normalizeChangedIds(ids) {
  return ids.filter(Boolean).map(String);
}

function removeScenarioChangedId(ids, scenarioId) {
  const id = String(scenarioId);
  console.log('removeScenarioChangedId', ids, scenarioId, Array.isArray(ids) ? ids.filter((entry) => String(entry) !== id) : []);
  return Array.isArray(ids) ? ids.filter((entry) => String(entry) !== id) : [];
}

function withScenarioChangedIds(state, scenarioId, changed) {
  const current = normalizeChangedIds(toChangedIds(state));
  const id = String(scenarioId);
  const next = changed ? Array.from(new Set([...current, id])) : current.filter((entry) => entry !== id);
  return next;
}

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @param {any} [_legacyState]
 * @param {{ hydrateBaseline?: Function, recomputeCapacity?: Function, invalidateCache?: Function }} [deps]
 * @returns {object}
 */
export function createScenarioCommands(store, bus, _legacyState = null, deps = {}) {
  const hydrateBaseline = deps.hydrateBaseline;
  const recomputeCapacity = deps.recomputeCapacity;
  const invalidateCache = deps.invalidateCache;

  function requireHydrateBaseline() {
    if (typeof hydrateBaseline !== 'function') {
      throw new TypeError('scenarioCommands requires hydrateBaseline');
    }
  }

  function requireRecomputeCapacity() {
    if (typeof recomputeCapacity !== 'function') {
      throw new TypeError('scenarioCommands requires recomputeCapacity');
    }
  }

  function requireInvalidateCache() {
    if (typeof invalidateCache !== 'function') {
      throw new TypeError('scenarioCommands requires invalidateCache');
    }
  }

  function recomputeAndEmitCapacity() {
    requireRecomputeCapacity();
    recomputeCapacity();
    bus?.emit?.(CapacityEvents.UPDATED);
  }

  function getScenarioById(id) {
    const targetId = id ?? store.getState()?.scenarios?.activeId ?? 'baseline';
    return toScenarioItems(store.getState()).find((scenario) => scenario.id === targetId) || null;
  }

  return {
    cloneScenario(sourceId, name, runtimeOptions = {}) {
      const snapshot = store.getState();
      const existingScenarios = toScenarioItems(snapshot);
      const sourceScenario = existingScenarios.find((scenario) => scenario.id === sourceId) || null;

      const requestedName = typeof name === 'string' && name.trim() ?
        name.trim()
        : createDefaultScenarioName(existingScenarios);
      const uniqueName = ensureUniqueScenarioName(requestedName, existingScenarios);

      const scenario = {
        id: createScenarioId(),
        name: uniqueName,
        overrides:
          sourceScenario ?
            cloneValue(sourceScenario.overrides)
            : cloneValue(runtimeOptions.currentOverrides),
        filters:
          sourceScenario ? cloneValue(sourceScenario.filters) : cloneValue(runtimeOptions.currentFilters),
        view: sourceScenario ? cloneValue(sourceScenario.view) : cloneValue(runtimeOptions.currentView),
      };

      const nextScenarios = [...existingScenarios, scenario];
      const nextChangedIds = withScenarioChangedIds(snapshot, scenario.id, true);
      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: withScenarioChangedIds(state, scenario.id, true),
            items: nextScenarios,
          },
        }),
        false,
        'scenario.cloneScenario'
      );

      bus?.emit?.(ScenarioEvents.UPDATED);
      emitScenarioList(bus, nextScenarios, snapshot?.scenarios?.activeId ?? 'baseline');

      return scenario;
    },

    activateScenario(id) {
      const currentState = store.getState();
      const currentActiveId = currentState?.scenarios?.activeId ?? 'baseline';
      if (currentActiveId === id) return null;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            activeId: id,
          },
        }),
        false,
        'scenario.activateScenario'
      );

      const scenarios = toScenarioItems(store.getState());
      bus?.emit?.(ScenarioEvents.ACTIVATED);
      recomputeAndEmitCapacity();
      bus?.emit?.(FeatureEvents.UPDATED);
      bus?.emit?.(GroupEvents.CHANGED);
      emitScenarioList(bus, scenarios, id);

      return scenarios.find((scenario) => scenario.id === id) || null;
    },

    renameScenario(id, newName) {
      if (id === 'baseline') return null;
      if (typeof newName !== 'string' || !newName.trim()) return null;

      const snapshot = store.getState();
      const existingScenarios = toScenarioItems(snapshot);
      const scenario = existingScenarios.find((candidate) => candidate.id === id);
      if (!scenario) return null;

      const peers = existingScenarios.filter((candidate) => candidate.id !== id);
      const uniqueName = ensureUniqueScenarioName(newName.trim(), peers);
      if (uniqueName === scenario.name) return scenario;

      const nextScenarios = existingScenarios.map((candidate) =>
        candidate.id === id ? { ...candidate, name: uniqueName } : candidate
      );

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            // Rename is persisted immediately (see ScenarioRenameModal), so it must
            // not mark the scenario as having unsaved changes.
            items: nextScenarios,
          },
        }),
        false,
        'scenario.renameScenario'
      );

      bus?.emit?.(ScenarioEvents.UPDATED);
      emitScenarioList(bus, nextScenarios, snapshot?.scenarios?.activeId ?? 'baseline');

      return nextScenarios.find((candidate) => candidate.id === id) || null;
    },

    deleteScenario(id) {
      if (id === 'baseline') return;
      const snapshot = store.getState();
      const existingScenarios = toScenarioItems(snapshot);
      const exists = existingScenarios.some((scenario) => scenario.id === id);
      if (!exists) return;

      const wasActive = (snapshot?.scenarios?.activeId ?? 'baseline') === id;
      const nextScenarios = existingScenarios.filter((scenario) => scenario.id !== id);
      const nextActiveId = wasActive ? 'baseline' : (snapshot?.scenarios?.activeId ?? 'baseline');

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: withScenarioChangedIds(state, id, false),
            items: nextScenarios,
            activeId: nextActiveId,
          },
        }),
        false,
        'scenario.deleteScenario'
      );

      bus?.emit?.(ScenarioEvents.UPDATED);
      if (wasActive) {
        bus?.emit?.(ScenarioEvents.ACTIVATED);
      }
      bus?.emit?.(FeatureEvents.UPDATED);
      emitScenarioList(bus, nextScenarios, nextActiveId);
    },

    markActiveScenarioChanged() {
      const snapshot = store.getState();
      const activeId = snapshot?.scenarios?.activeId ?? 'baseline';
      if (!activeId || activeId === 'baseline') return false;

      const existingScenarios = toScenarioItems(snapshot);
      const changedIds = toChangedIds(snapshot);
      const alreadyChanged = changedIds.includes(String(activeId));
      if (alreadyChanged) return false;

      const nextScenarios = existingScenarios;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: withScenarioChangedIds(state, activeId, true),
            items: nextScenarios,
          },
        }),
        false,
        'scenario.markActiveScenarioChanged'
      );

      bus?.emit?.(ScenarioEvents.UPDATED);
      emitScenarioList(bus, nextScenarios, activeId);
      return true;
    },

    async saveScenario(id) {
      const scenario = getScenarioById(id);
      if (!scenario || scenario.id === 'baseline') {
        return { ok: true, data: scenario };
      }

      const result = await dataService.saveScenario(scenario);
      if (result && Object.prototype.hasOwnProperty.call(result, 'ok') && result.ok === false) {
        return result;
      }

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            changedIds: removeScenarioChangedId(state.scenarios.changedIds, scenario.id),
          },
        }),
        false,
        'scenario.saveScenario.clearDirty'
      );

      bus.emit(ScenarioEvents.SAVED, { scenarioId: scenario.id });
      bus.emit(ScenarioEvents.UPDATED);

      return result ?? { ok: true, data: scenario };
    },

    async refreshBaseline() {
      requireHydrateBaseline();
      return hydrateBaseline();
    },

    async invalidateAndRefreshBaseline() {
      requireInvalidateCache();
      const invalidation = await invalidateCache();
      if (invalidation && invalidation.ok === false) {
        console.warn('Scenario baseline invalidation failed, continuing with refresh', invalidation.error);
      }
      requireHydrateBaseline();
      return hydrateBaseline();
    },
  };
}
