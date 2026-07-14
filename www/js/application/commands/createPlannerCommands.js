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
export function createPlannerCommands({ store, services }) {
  function updateSelectionIds(label, key, selections) {
    const safeSelections = asObject(selections);
    store.update(label, (draft) => {
      const next = new Set(asArray(draft.selection[key]));
      for (const [id, selected] of Object.entries(safeSelections)) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      draft.selection[key] = Array.from(next);
    });
  }

  function updateScenarioItems(label, mutateItems, finalizeDraft) {
    store.update(label, (draft) => {
      const nextItems = mutateItems(asArray(draft.scenarios.items));
      draft.scenarios.items = nextItems;
      finalizeDraft?.(draft, nextItems);
    });
  }

  function updateFeatureItems(label, mutateFeature) {
    let updated = false;
    store.update(label, (draft) => {
      draft.baseline.features = asArray(draft.baseline.features).map((feature) => {
        if (!feature?.id) return feature;
        const nextFeature = mutateFeature(feature);
        if (nextFeature === feature) return feature;
        updated = true;
        return nextFeature;
      });
    });
    return updated;
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
    updateSelectionIds('selection.project.command', 'projectIds', { [id]: !!selected });
  }

  function commitSelectionTeam(id, selected) {
    updateSelectionIds('selection.team.command', 'teamIds', { [id]: !!selected });
  }

  function commitSelectionProjectBulk(selections) {
    updateSelectionIds('selection.project.bulk.command', 'projectIds', selections);
  }

  function commitSelectionTeamBulk(selections) {
    updateSelectionIds('selection.team.bulk.command', 'teamIds', selections);
  }

  function commitExpansion(options) {
    const safeOptions = asObject(options);
    store.update('view.expansion.command', (draft) => {
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
    store.update('scenario.activate.command', (draft) => {
      draft.scenarios.activeId = id || null;
    });
  }

  function commitRenameScenario(id, newName) {
    updateScenarioItems('scenario.rename.command', (items) =>
      items.map((scenario) =>
        scenario?.id === id
          ? {
              ...scenario,
              name: newName,
            }
          : scenario
      )
    );
  }

  function commitDeleteScenario(id) {
    updateScenarioItems(
      'scenario.delete.command',
      (items) => items.filter((scenario) => scenario?.id !== id),
      (draft, nextItems) => {
        if (draft.scenarios.activeId === id) {
          draft.scenarios.activeId = nextItems[0]?.id || null;
        }
      }
    );
  }

  function commitSavedScenario(id) {
    updateScenarioItems('scenario.save.command', (items) =>
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

  function commitFeatureField(id, field, value) {
    updateFeatureItems('feature.field.command', (feature) =>
      feature?.id === id
        ? {
            ...feature,
            [field]: value,
          }
        : feature
    );
  }

  function commitFeatureRelations(id, relations) {
    return updateFeatureItems('feature.relations.command', (feature) =>
      feature?.id === id
        ? {
            ...feature,
            relations,
          }
        : feature
    );
  }

  function commitFeatureRevert(id) {
    updateFeatureItems('feature.revert.command', (feature) =>
      feature?.id === id
        ? {
            ...feature,
            start: undefined,
            end: undefined,
          }
        : feature
    );
  }

  function commitScenarioOverride(featureId, start, end) {
    updateFeatureItems('scenario.override.command', (feature) =>
      feature?.id === featureId
        ? {
            ...feature,
            start,
            end,
          }
        : feature
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
      commitSelectionProject(id, !!selected);
      runRuntimeMutation('runtime.setProjectSelected', (runtime) => {
        runtime.setProjectSelected?.(id, selected);
      }, { preserveSelection: true });
    },

    setTeamSelected(id, selected) {
      commitSelectionTeam(id, !!selected);
      runRuntimeMutation('runtime.setTeamSelected', (runtime) => {
        runtime.setTeamSelected?.(id, selected);
      }, { preserveSelection: true });
    },

    setProjectsSelectedBulk(selections) {
      commitSelectionProjectBulk(selections);
      runRuntimeMutation('runtime.setProjectsSelectedBulk', (runtime) => {
        runtime.setProjectsSelectedBulk?.(selections);
      }, { preserveSelection: true });
    },

    setTeamsSelectedBulk(selections) {
      commitSelectionTeamBulk(selections);
      runRuntimeMutation('runtime.setTeamsSelectedBulk', (runtime) => {
        runtime.setTeamsSelectedBulk?.(selections);
      }, { preserveSelection: true });
    },

    setExpansionState(options) {
      commitExpansion(options);
      runRuntimeMutation('runtime.setExpansionState', (runtime) => {
        runtime.setExpansionState?.(options);
      }, { preserveExpansion: true, preserveSelection: true });
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

    clearPendingGroupChanges: createRuntimeDelegate(
      'runtime.clearPendingGroupChanges',
      'clearPendingGroupChanges'
    ),

    confirmGroupCreate: createRuntimeDelegate('runtime.confirmGroupCreate', 'confirmGroupCreate'),

    createGroupInScenario: createRuntimeDelegate(
      'runtime.createGroupInScenario',
      'createGroupInScenario'
    ),

    updateGroupInScenario: createRuntimeDelegate(
      'runtime.updateGroupInScenario',
      'updateGroupInScenario'
    ),

    deleteGroupInScenario: createRuntimeDelegate(
      'runtime.deleteGroupInScenario',
      'deleteGroupInScenario'
    ),

    applyGroupMemberDelta: createRuntimeDelegate(
      'runtime.applyGroupMemberDelta',
      'applyGroupMemberDelta'
    ),

    markGroupChanged: createRuntimeDelegate('runtime.markGroupChanged', 'markGroupChanged'),

    updateFeatureDates(updates) {
      runRuntimeMutation('runtime.updateFeatureDates', (runtime) => {
        if (typeof runtime._updateFeatureDatesLegacy === 'function') {
          runtime._updateFeatureDatesLegacy(updates, {
            emitCapacitySideEffects: false,
          });
          if (runtime._shouldRunFeatureDateCapacitySideEffects?.(updates)) {
            runtime._applyFeatureDateCapacitySideEffectsLegacy?.(updates);
          }
          return;
        }
        runtime.updateFeatureDates?.(updates);
      });
    },

    updateFeatureField(id, field, value) {
      commitFeatureField(id, field, value);
      runRuntimeMutation('runtime.updateFeatureField', (runtime) => {
        if (typeof runtime._updateFeatureFieldLegacy === 'function') {
          const updated = runtime._updateFeatureFieldLegacy(id, field, value, {
            emitCapacitySideEffects: false,
            emitScenarioSideEffects: false,
          });
          if (
            updated !== false &&
            runtime._shouldRunFeatureFieldCapacitySideEffects?.(field, updated)
          ) {
            runtime._applyFeatureFieldCapacitySideEffectsLegacy?.(id);
          }
          if (updated !== false) {
            runtime._emitFeatureFieldScenarioSideEffectsLegacy?.(id, field);
          }
          return;
        }
        runtime.updateFeatureField?.(id, field, value);
      }, { preserveBaselineFeatures: true });
    },

    updateFeatureRelations(id, relations) {
      const updated = commitFeatureRelations(id, relations);
      if (!updated) return false;
      return runRuntimeMutation('runtime.updateFeatureRelations', (runtime) => {
        if (typeof runtime._updateFeatureRelationsLegacy === 'function') {
          return !!runtime._updateFeatureRelationsLegacy(id, relations);
        }
        return !!runtime.updateFeatureRelations?.(id, relations);
      }, { preserveBaselineFeatures: true });
    },

    revertFeature(id) {
      commitFeatureRevert(id);
      runRuntimeMutation('runtime.revertFeature', (runtime) => {
        if (typeof runtime._revertFeatureLegacy === 'function') {
          const reverted = runtime._revertFeatureLegacy(id, {
            emitCapacitySideEffects: false,
            emitScenarioSideEffects: false,
          });
          if (
            reverted !== false &&
            runtime._shouldRunFeatureRevertCapacitySideEffects?.(reverted)
          ) {
            runtime._applyFeatureRevertCapacitySideEffectsLegacy?.(id);
          }
          if (reverted !== false) {
            runtime._emitFeatureRevertScenarioSideEffectsLegacy?.(id);
          }
          return;
        }
        runtime.revertFeature?.(id);
      }, { preserveBaselineFeatures: true });
    },

    activateScenario(id) {
      commitActiveScenario(id);
      runRuntimeMutation('runtime.activateScenario', (runtime) => {
        runtime.activateScenario?.(id);
      }, { preserveScenarios: true });
    },

    setScenarioOverride(featureId, start, end) {
      commitScenarioOverride(featureId, start, end);
      runRuntimeMutation('runtime.setScenarioOverride', (runtime) => {
        runtime.setScenarioOverride?.(featureId, start, end);
      }, { preserveBaselineFeatures: true });
    },

    cloneScenario: createRuntimeDelegate('runtime.cloneScenario', 'cloneScenario'),

    renameScenario(id, newName) {
      commitRenameScenario(id, newName);
      runRuntimeMutation('runtime.renameScenario', (runtime) => {
        runtime.renameScenario?.(id, newName);
      }, { preserveScenarios: true });
    },

    deleteScenario(id) {
      commitDeleteScenario(id);
      runRuntimeMutation('runtime.deleteScenario', (runtime) => {
        runtime.deleteScenario?.(id);
      }, { preserveScenarios: true });
    },

    async saveScenario(id) {
      commitSavedScenario(id);
      return runRuntimeMutationAsync('runtime.saveScenario', async (runtime) => {
        return runtime.saveScenario?.(id);
      }, { preserveScenarios: true });
    },
  };
}
