import { planViewRestoreUiEffects, syncRuntimeSnapshot } from '../runtimeSnapshot.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Command factory for Planner application composition.
 *
 * Idempotency classes:
 * - initialize: state idempotent, IO guarded (depends on service init ordering)
 * - destroy: strong idempotent
 */
export function createPlannerCommands({ store, services, selectors }) {
  function updateSelectionIds(label, key, selections) {
    const safeSelections = asObject(selections);
    return store.update(label, (draft) => {
      const next = new Set(asArray(draft.selection[key]));
      for (const [id, selected] of Object.entries(safeSelections)) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      draft.selection[key] = Array.from(next);
    });
  }

  function updateScenarioItems(label, mutateItems, finalizeDraft) {
    return store.update(label, (draft) => {
      const nextItems = mutateItems(asArray(draft.scenarios.items));
      draft.scenarios.items = nextItems;
      finalizeDraft?.(draft, nextItems);
    });
  }

  function runRuntimeMutation(label, applyMutation, syncOptions = {}) {
    const runtime = services?.runtime;
    if (!runtime || typeof applyMutation !== 'function') return;
    const result = applyMutation(runtime);
    syncRuntimeSnapshot(store, runtime, label, syncOptions);
    return result;
  }

  async function runRuntimeMutationAsync(label, applyMutation, syncOptions = {}) {
    const runtime = services?.runtime;
    if (!runtime || typeof applyMutation !== 'function') return undefined;
    const result = await applyMutation(runtime);
    syncRuntimeSnapshot(store, runtime, label, syncOptions);
    return result;
  }

  function createRuntimeDelegate(label, methodName, syncOptions = {}) {
    return (...args) => runRuntimeMutation(label, (runtime) => runtime[methodName]?.(...args), syncOptions);
  }

  function commitSelectionProject(id, selected) {
    return updateSelectionIds('selection.project.command', 'projectIds', { [id]: !!selected });
  }

  function commitSelectionTeam(id, selected) {
    return updateSelectionIds('selection.team.command', 'teamIds', { [id]: !!selected });
  }

  function commitSelectionProjectBulk(selections) {
    return updateSelectionIds('selection.project.bulk.command', 'projectIds', selections);
  }

  function commitSelectionTeamBulk(selections) {
    return updateSelectionIds('selection.team.bulk.command', 'teamIds', selections);
  }

  function commitExpansion(options) {
    const safeOptions = asObject(options);
    return store.update('view.expansion.command', (draft) => {
      if (safeOptions.expandParentChild !== undefined) {
        draft.view.expansion.parentChild = !!safeOptions.expandParentChild;
      }
      if (safeOptions.expandRelations !== undefined) {
        draft.view.expansion.relations = !!safeOptions.expandRelations;
      }
      if (safeOptions.expandTeamAllocated !== undefined) {
        draft.view.expansion.teamAllocated = !!safeOptions.expandTeamAllocated;
      }
    });
  }

  function commitActiveScenario(id) {
    return store.update('scenario.activate.command', (draft) => {
      draft.scenarios.activeId = id || null;
    });
  }

  function commitRenameScenario(id, newName) {
    return updateScenarioItems('scenario.rename.command', (items) =>
      items.map((scenario) =>
        scenario?.id === id
          ? {
              ...scenario,
              name: newName,
              isChanged: true,
            }
          : scenario
      )
    );
  }

  function commitDeleteScenario(id) {
    return updateScenarioItems(
      'scenario.delete.command',
      (items) => items.filter((scenario) => scenario?.id !== id || scenario?.readonly),
      (draft) => {
        if (draft.scenarios.activeId === id) {
          draft.scenarios.activeId = draft.scenarios.items.find((scenario) => scenario?.readonly)?.id || null;
        }
      }
    );
  }

  function commitSavedScenario(id) {
    return updateScenarioItems('scenario.save.command', (items) =>
      items.map((scenario) =>
        scenario?.id === id
          ? {
              ...scenario,
              isChanged: false,
            }
          : scenario
      )
    );
  }

  return {
    initialize() {
      const runtime = services?.runtime;
      if (!runtime) return;
      syncRuntimeSnapshot(store, runtime, 'runtime.initialize');
    },

    destroy() {},

    syncFromLegacyState() {
      const runtime = services?.runtime;
      if (!runtime) return;
      syncRuntimeSnapshot(store, runtime, 'runtime.syncFromLegacyState');
    },

    hydrateScenarioData(items) {
      const runtime = services?.runtime;
      if (!runtime) return;
      const next = runtime.prepareScenarioHydration(items);
      store.update('scenario.remoteData.command', (draft) => {
        draft.scenarios.items = asArray(next.items);
        draft.scenarios.activeId = next.activeId || null;
      });
      runtime.emitScenarioList();
      runtime.emitScenarioActivated();
      runtime.emitFeatureUpdated([]);
    },

    async performAutosaveTick() {
      const runtime = services?.runtime;
      if (!runtime) return [];

      if (typeof runtime.performAutosave === 'function') {
        const results = await runtime.performAutosave({ logFailures: false });
        for (const result of asArray(results)) {
          if (result?.ok) continue;
          console.warn(
            'Autosave scenario failed',
            result?.scenarioId || 'unknown',
            result?.errorMessage || 'unknown'
          );
        }
        return results;
      }

      return [];
    },

    applyViewSelectionRestore: createRuntimeDelegate(
      'runtime.applyViewSelectionRestore',
      'applyViewSelectionRestore'
    ),

    planViewRestoreUiEffects(payload = {}) {
      const runtime = services?.runtime;
      if (!runtime) return planViewRestoreUiEffects(payload);

      if (typeof runtime.planViewRestoreUiEffects === 'function') {
        return runtime.planViewRestoreUiEffects(payload);
      }

      return planViewRestoreUiEffects(payload);
    },

    applyViewOptionsRestore: createRuntimeDelegate(
      'runtime.applyViewOptionsRestore',
      'applyViewOptionsRestore'
    ),

    async applyViewPluginStateRestore(payload) {
      return runRuntimeMutationAsync('runtime.applyViewPluginStateRestore', async (runtime) => {
        return runtime.applyViewPluginStateRestore?.({
          ...(payload || {}),
          logFailures: false,
        });
      });
    },

    setProjectSelected(id, selected) {
      if (commitSelectionProject(id, !!selected)) {
        services?.runtime?.handleProjectSelectionChanged?.();
      }
    },

    setTeamSelected(id, selected) {
      if (commitSelectionTeam(id, !!selected)) {
        services?.runtime?.handleTeamSelectionChanged?.();
      }
    },

    setProjectsSelectedBulk(selections) {
      if (commitSelectionProjectBulk(selections)) {
        services?.runtime?.handleProjectSelectionChanged?.();
      }
    },

    setTeamsSelectedBulk(selections) {
      if (commitSelectionTeamBulk(selections)) {
        services?.runtime?.handleTeamSelectionChanged?.();
      }
    },

    setExpansionState(options) {
      const previousTeamAllocation = !!store.getState().view.expansion.teamAllocated;
      if (commitExpansion(options)) {
        services?.runtime?.handleExpansionChanged?.(previousTeamAllocation);
      }
    },

    setSidebarDisabledElements: createRuntimeDelegate(
      'runtime.setSidebarDisabledElements',
      'setSidebarDisabledElements'
    ),

    clearSidebarDisabledElements: createRuntimeDelegate(
      'runtime.clearSidebarDisabledElements',
      'clearSidebarDisabledElements'
    ),

    setSelectedTaskTypes: createRuntimeDelegate(
      'runtime.setSelectedTaskTypes',
      'setSelectedTaskTypes'
    ),

    setSelectedStates: createRuntimeDelegate('runtime.setSelectedStates', 'setSelectedStates'),

    setAvailableFeatureStates: createRuntimeDelegate(
      'runtime.setAvailableFeatureStates',
      'setAvailableFeatureStates'
    ),

    setAllStatesSelected: createRuntimeDelegate(
      'runtime.setAllStatesSelected',
      'setAllStatesSelected'
    ),

    toggleStateSelected: createRuntimeDelegate(
      'runtime.toggleStateSelected',
      'toggleStateSelected'
    ),

    setStateFilter: createRuntimeDelegate('runtime.setStateFilter', 'setStateFilter'),

    setTimelineScale: createRuntimeDelegate('runtime.setTimelineScale', 'setTimelineScale'),

    setTypeVisibility: createRuntimeDelegate('runtime.setTypeVisibility', 'setTypeVisibility'),

    setDisplayMode: createRuntimeDelegate('runtime.setDisplayMode', 'setDisplayMode'),

    setCondensedCards: createRuntimeDelegate('runtime.setCondensedCards', 'setCondensedCards'),

    setShowDependencies: createRuntimeDelegate(
      'runtime.setShowDependencies',
      'setShowDependencies'
    ),

    setShowUnplannedWork: createRuntimeDelegate(
      'runtime.setShowUnplannedWork',
      'setShowUnplannedWork'
    ),

    setShowUnallocatedCards: createRuntimeDelegate(
      'runtime.setShowUnallocatedCards',
      'setShowUnallocatedCards'
    ),

    setShowOnlyProjectHierarchy: createRuntimeDelegate(
      'runtime.setShowOnlyProjectHierarchy',
      'setShowOnlyProjectHierarchy'
    ),

    setCapacityViewMode: createRuntimeDelegate(
      'runtime.setCapacityViewMode',
      'setCapacityViewMode'
    ),

    setFeatureSortMode: createRuntimeDelegate(
      'runtime.setFeatureSortMode',
      'setFeatureSortMode'
    ),

    setHighlightFeatureRelationMode: createRuntimeDelegate(
      'runtime.setHighlightFeatureRelationMode',
      'setHighlightFeatureRelationMode'
    ),

    clearPendingGroupChanges() {
      return services?.runtime?.clearPendingGroupChanges?.();
    },

    confirmGroupCreate(tempId, realId) {
      return services?.runtime?.confirmGroupCreate?.(tempId, realId);
    },

    createGroupInScenario(planId, name, color = null, parentId = null) {
      return services?.runtime?.createGroupInScenario?.(planId, name, color, parentId) || null;
    },

    updateGroupInScenario(groupId, fields) {
      return services?.runtime?.updateGroupInScenario?.(groupId, fields) || null;
    },

    deleteGroupInScenario(groupId) {
      return services?.runtime?.deleteGroupInScenario?.(groupId);
    },

    applyGroupMemberDelta(groupId, taskId, op) {
      return services?.runtime?.applyGroupMemberDelta?.(groupId, taskId, op);
    },

    updateFeatureDates(updates) {
      return services?.runtime?.updateFeatureDates?.(updates) || 0;
    },

    updateFeatureField(id, field, value) {
      return services?.runtime?.updateFeatureField?.(id, field, value) || false;
    },

    updateFeatureRelations(id, relations) {
      return services?.runtime?.updateFeatureRelations?.(id, relations) || false;
    },

    revertFeature(id) {
      return services?.runtime?.revertFeature?.(id) || false;
    },

    activateScenario(id) {
      if (!commitActiveScenario(id)) return false;
      services?.runtime?.activateScenario?.(id);
      return true;
    },

    setScenarioOverride(featureId, start, end) {
      return services?.runtime?.setScenarioOverride?.(featureId, start, end) || false;
    },

    cloneScenario(sourceId, name) {
      const scenario = services?.runtime?.cloneScenario?.(sourceId, name);
      if (!scenario) return null;
      updateScenarioItems('scenario.clone.command', (items) => [...items, scenario]);
      services?.runtime?.emitScenarioUpdated?.(scenario.id, { type: 'clone', from: sourceId });
      return scenario;
    },

    renameScenario(id, newName) {
      const normalized = services?.runtime?.renameScenario?.(id, newName) ?? newName;
      if (!commitRenameScenario(id, normalized)) return false;
      services?.runtime?.emitScenarioUpdated?.(id, { type: 'rename', name: normalized });
      return true;
    },

    deleteScenario(id) {
      const wasActive = selectors?.scenarios?.().activeId === id;
      if (!commitDeleteScenario(id)) return false;
      services?.runtime?.deleteScenario?.(id);
      if (wasActive) services?.runtime?.emitScenarioActivated?.();
      return true;
    },

    async saveScenario(id) {
      const saved = await services?.runtime?.saveScenario?.(id);
      if (!saved) return saved;
      commitSavedScenario(id);
      services?.runtime?.emitScenarioUpdated?.(id, { type: 'saved' });
      return saved;
    },
  };
}
