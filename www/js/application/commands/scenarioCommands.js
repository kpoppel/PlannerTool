import { CapacityEvents, FeatureEvents, GroupEvents, ScenarioEvents } from '../../core/EventRegistry.js';

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

export function createScenarioCommands(store, bus, legacyState = null) {
  function canAssignProperty(target, prop) {
    if (!target || typeof target !== 'object') return false;
    let current = target;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, prop);
      if (descriptor) {
        if (typeof descriptor.set === 'function') return true;
        return descriptor.writable === true;
      }
      current = Object.getPrototypeOf(current);
    }
    return true;
  }

  function tryAssignProperty(target, prop, value) {
    if (!canAssignProperty(target, prop)) return false;
    try {
      target[prop] = value;
      return true;
    } catch {
      return false;
    }
  }

  function syncLegacyScenarioState(nextScenarios, nextActiveId) {
    if (!legacyState) return;

    const clonedScenarios = Array.isArray(nextScenarios) ? structuredClone(nextScenarios) : [];
    const activeId = nextActiveId ?? 'baseline';

    const wroteScenarios = tryAssignProperty(legacyState, 'scenarios', clonedScenarios);
    if (!wroteScenarios && legacyState?._scenarioEventService) {
      const existingReadonly = (legacyState._scenarioEventService.getScenarios?.() || []).filter(
        (scenario) => scenario && scenario.readonly
      );
      legacyState._scenarioEventService._scenarios = [
        ...existingReadonly,
        ...structuredClone(clonedScenarios),
      ];
    }

    const wroteActiveId = tryAssignProperty(legacyState, 'activeScenarioId', activeId);
    if (!wroteActiveId && legacyState?._scenarioEventService?.setActiveScenarioId) {
      legacyState._scenarioEventService.setActiveScenarioId(activeId);
    }
  }

  function buildCapacityPayload() {
    const snapshot = store.getState()?.capacity || {};
    return {
      dates: legacyState?.capacityDates ?? snapshot.dates ?? [],
      teamDailyCapacity: legacyState?.teamDailyCapacity ?? snapshot.teamDaily ?? [],
      teamDailyCapacityMap: legacyState?.teamDailyCapacityMap ?? snapshot.teamDailyMap ?? [],
      projectDailyCapacityRaw: legacyState?.projectDailyCapacityRaw ?? snapshot.projectDailyRaw ?? [],
      projectDailyCapacity: legacyState?.projectDailyCapacity ?? snapshot.projectDaily ?? [],
      projectDailyCapacityMap: legacyState?.projectDailyCapacityMap ?? snapshot.projectDailyMap ?? [],
      totalOrgDailyCapacity: legacyState?.totalOrgDailyCapacity ?? snapshot.organizationDaily ?? [],
      totalOrgDailyPerTeamAvg:
        legacyState?.totalOrgDailyPerTeamAvg ?? snapshot.organizationDailyPerTeamAverage ?? [],
    };
  }

  function syncCapacityFromLegacy() {
    if (!legacyState) return;
    store.setState(
      (state) => ({
        ...state,
        capacity: {
          dates: Array.isArray(legacyState.capacityDates) ? legacyState.capacityDates : [],
          teamDaily: Array.isArray(legacyState.teamDailyCapacity) ? legacyState.teamDailyCapacity : [],
          teamDailyMap:
            Array.isArray(legacyState.teamDailyCapacityMap) ? legacyState.teamDailyCapacityMap : [],
          projectDailyRaw:
            Array.isArray(legacyState.projectDailyCapacityRaw) ?
              legacyState.projectDailyCapacityRaw
            : [],
          projectDaily:
            Array.isArray(legacyState.projectDailyCapacity) ? legacyState.projectDailyCapacity : [],
          projectDailyMap:
            Array.isArray(legacyState.projectDailyCapacityMap) ?
              legacyState.projectDailyCapacityMap
            : [],
          organizationDaily:
            Array.isArray(legacyState.totalOrgDailyCapacity) ? legacyState.totalOrgDailyCapacity : [],
          organizationDailyPerTeamAverage:
            Array.isArray(legacyState.totalOrgDailyPerTeamAvg) ?
              legacyState.totalOrgDailyPerTeamAvg
            : [],
        },
      }),
      false,
      'scenario.syncCapacityFromLegacy'
    );
  }

  function recomputeAndEmitCapacity(changedFeatureIds = null) {
    if (typeof legacyState?.recomputeCapacityMetrics === 'function') {
      legacyState.recomputeCapacityMetrics(changedFeatureIds);
      syncCapacityFromLegacy();
    }
    bus?.emit?.(CapacityEvents.UPDATED, buildCapacityPayload());
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
      syncLegacyScenarioState(nextScenarios, snapshot?.scenarios?.activeId ?? 'baseline');
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
      syncLegacyScenarioState(scenarios, id);
      bus?.emit?.(ScenarioEvents.ACTIVATED, { scenarioId: id });
      recomputeAndEmitCapacity();
      bus?.emit?.(FeatureEvents.UPDATED);
      bus?.emit?.(GroupEvents.CHANGED, { op: 'scenarioSwitched' });
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

      syncLegacyScenarioState(nextScenarios, snapshot?.scenarios?.activeId ?? 'baseline');
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

      syncLegacyScenarioState(nextScenarios, nextActiveId);
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

      syncLegacyScenarioState(nextScenarios, activeId);
      bus?.emit?.(ScenarioEvents.UPDATED, {
        scenarioId: activeId,
        change: { type: 'markedChanged' },
      });
      emitScenarioList(bus, nextScenarios, activeId);
      return true;
    },

    async saveScenario(id) {
      if (typeof legacyState?.saveScenario !== 'function') return null;
      return legacyState.saveScenario(id);
    },

    async refreshBaseline() {
      if (typeof legacyState?.refreshBaseline !== 'function') return null;
      return legacyState.refreshBaseline();
    },

    async invalidateAndRefreshBaseline() {
      if (typeof legacyState?.invalidateAndRefreshBaseline !== 'function') return null;
      return legacyState.invalidateAndRefreshBaseline();
    },
  };
}
