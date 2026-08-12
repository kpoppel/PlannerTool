import { CapacityEvents, FeatureEvents, GroupEvents, ScenarioEvents } from '../../core/EventRegistry.js';
import { dataService } from '../../services/dataService.js';

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
  bus?.emit?.(ScenarioEvents.LIST, {
    scenarios: scenarios
      .filter((scenario) => scenario.id !== 'baseline')
      .map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        overridesCount: Object.keys(scenario.overrides || {}).length,
        unsaved: scenario.isChanged === true,
        readonly: scenario.readonly === true,
      })),
    activeScenarioId,
  });
}

function toScenarioItems(storeState) {
  return Array.isArray(storeState?.scenarios?.items) ? storeState.scenarios.items : [];
}

export function createLegacyScenarioCommands(state) {
  return {
    cloneScenario(sourceId, name) {
      return state.cloneScenario(sourceId, name);
    },

    activateScenario(id) {
      return state.activateScenario(id);
    },

    renameScenario(id, name) {
      return state.renameScenario(id, name);
    },

    deleteScenario(id) {
      return state.deleteScenario(id);
    },

    markActiveScenarioChanged() {
      return state._markActiveScenarioChanged();
    },

    saveScenario(id) {
      return state.saveScenario(id);
    },

    refreshBaseline() {
      return state.refreshBaseline();
    },

    invalidateAndRefreshBaseline() {
      return state.invalidateAndRefreshBaseline();
    },
  };
}

export function createScenarioCommands(store, bus, _legacyState = null, deps = {}) {
  const hydrateBaseline = typeof deps.hydrateBaseline === 'function' ? deps.hydrateBaseline : null;
  const hydrateScenarioData = typeof deps.hydrateScenarioData === 'function' ? deps.hydrateScenarioData : null;
  const recomputeCapacity = typeof deps.recomputeCapacity === 'function' ? deps.recomputeCapacity : null;
  const invalidateCache = typeof deps.invalidateCache === 'function' ? deps.invalidateCache : () => dataService.invalidateCache();

  function recomputeAndEmitCapacity() {
    if (recomputeCapacity) {
      recomputeCapacity();
    }
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
        isChanged: true,
      };

      const nextScenarios = [...existingScenarios, scenario];
      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: nextScenarios,
          },
        }),
        false,
        'scenario.cloneScenario'
      );

      bus?.emit?.(ScenarioEvents.UPDATED, {
        scenarioId: scenario.id,
        change: { type: 'clone', from: sourceId },
      });
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
      bus?.emit?.(ScenarioEvents.ACTIVATED, { scenarioId: id });
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
        candidate.id === id ? { ...candidate, name: uniqueName, isChanged: true } : candidate
      );

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: nextScenarios,
          },
        }),
        false,
        'scenario.renameScenario'
      );

      bus?.emit?.(ScenarioEvents.UPDATED, {
        scenarioId: id,
        change: { type: 'rename', name: uniqueName },
      });
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
            items: nextScenarios,
            activeId: nextActiveId,
          },
        }),
        false,
        'scenario.deleteScenario'
      );

      bus?.emit?.(ScenarioEvents.UPDATED, {
        scenarioId: id,
        change: { type: 'delete' },
      });
      if (wasActive) {
        bus?.emit?.(ScenarioEvents.ACTIVATED, { scenarioId: 'baseline' });
      }
      bus?.emit?.(FeatureEvents.UPDATED);
      emitScenarioList(bus, nextScenarios, nextActiveId);
    },

    markActiveScenarioChanged() {
      const snapshot = store.getState();
      const activeId = snapshot?.scenarios?.activeId ?? 'baseline';
      if (!activeId || activeId === 'baseline') return false;

      const existingScenarios = toScenarioItems(snapshot);
      let changed = false;
      const nextScenarios = existingScenarios.map((scenario) => {
        if (scenario.id !== activeId) return scenario;
        if (scenario.isChanged) return scenario;
        changed = true;
        return { ...scenario, isChanged: true };
      });

      if (!changed) return false;

      store.setState(
        (state) => ({
          ...state,
          scenarios: {
            ...state.scenarios,
            items: nextScenarios,
          },
        }),
        false,
        'scenario.markActiveScenarioChanged'
      );

      bus?.emit?.(ScenarioEvents.UPDATED, {
        scenarioId: activeId,
        change: { type: 'markedChanged' },
      });
      emitScenarioList(bus, nextScenarios, activeId);
      return true;
    },

    async saveScenario(id) {
      const scenario = getScenarioById(id);
      if (!scenario || scenario.id === 'baseline') {
        return { ok: true, data: scenario }; 
      }

      const payload = {
        id: scenario.id,
        name: scenario.name,
        overrides: scenario.overrides,
        filters: scenario.filters,
        view: scenario.view,
        scenarioGroups: Array.isArray(scenario.scenarioGroups) && scenario.scenarioGroups.length > 0
          ? [...scenario.scenarioGroups]
          : undefined,
        groupOverrides: scenario.groupOverrides && Object.keys(scenario.groupOverrides).length > 0
          ? { ...scenario.groupOverrides }
          : undefined,
      };

      const result = await dataService.saveScenario(payload);
      if (result && result.ok === true) {
        let nextScenarios = toScenarioItems(store.getState());

        if (typeof hydrateScenarioData === 'function') {
          const hydrated = await hydrateScenarioData();
          if (hydrated && hydrated.ok === false) {
            console.warn('Scenario save refreshed store from server but hydration failed', hydrated.error);
          }
          nextScenarios = toScenarioItems(store.getState());
        } else {
          nextScenarios = nextScenarios.map((item) =>
            item.id === scenario.id ? { ...item, isChanged: false } : item
          );

          store.setState(
            (state) => ({
              ...state,
              scenarios: {
                ...state.scenarios,
                items: nextScenarios,
              },
            }),
            false,
            'scenario.saveScenario'
          );
        }

        bus?.emit?.(ScenarioEvents.SAVED, { scenarioId: scenario.id });
        bus?.emit?.(ScenarioEvents.UPDATED, {
          scenarioId: scenario.id,
          change: { type: 'saved' },
        });
        emitScenarioList(bus, nextScenarios, store.getState()?.scenarios?.activeId ?? 'baseline');
      }

      return result;
    },

    async refreshBaseline() {
      if (typeof hydrateBaseline === 'function') {
        return hydrateBaseline();
      }
      return { ok: false, error: { message: 'baseline hydration not configured for store mode' } };
    },

    async invalidateAndRefreshBaseline() {
      const invalidation = await invalidateCache();
      if (invalidation && invalidation.ok === false) {
        console.warn('Scenario baseline invalidation failed, continuing with refresh', invalidation.error);
      }
      if (typeof hydrateBaseline === 'function') {
        return hydrateBaseline();
      }
      return { ok: false, error: { message: 'baseline hydration not configured for store mode' } };
    },
  };
}
