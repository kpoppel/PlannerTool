import { selectScenarioSavePayload } from '../selectors/scenarioSelectors.js';
import { FilterEvents } from '../../core/EventRegistry.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Build UI effect objects from view restore payload.
 * @param {object} payload
 * @returns {Array<object>}
 */
function planViewRestoreUiEffects(payload = {}) {
  const effects = [];
  const selectedTaskTypes = Array.isArray(payload?.selectedTaskTypes)
    ? payload.selectedTaskTypes.filter(Boolean)
    : null;
  const graphType = typeof payload?.graphType === 'string' ? payload.graphType : null;
  const expansion =
    payload?.expansion && typeof payload.expansion === 'object' ? payload.expansion : null;

  if (selectedTaskTypes) {
    effects.push({
      type: 'setSelectedTaskTypes',
      selectedTaskTypes,
    });
  }

  if (graphType) {
    effects.push({
      type: 'setGraphType',
      graphType,
    });
  }

  if (expansion) {
    effects.push({
      type: 'setExpansionState',
      expansion,
    });
    effects.push({ type: 'recomputeDataFunnel' });
  }

  effects.push({ type: 'requestSidebarUpdate' });
  return effects;
}

/**
 * Command factory for Planner application composition.
 *
 * Idempotency classes:
 * - initialize: state idempotent, IO guarded (depends on service init ordering)
 * - destroy: strong idempotent
 */
export function createPlannerCommands({ store, services, selectors }) {
  function mutateActiveWritableScenario(label, mutate) {
    let result = false;
    store.update(label, (draft) => {
      const items = asArray(draft.scenarios.items);
      const activeId = draft.scenarios.activeId;
      const scenario = items.find(
        (item) => item?.id === activeId && item?.readonly !== true
      );
      if (!scenario) return;
      result = mutate(scenario, draft);
    });
    return result;
  }

  function recomputeRuntimeCapacity(changedFeatureIds = null, { onlyIfCalculated = false } = {}) {
    const runtime = services?.runtime;
    if (!runtime?.recomputeCapacityMetrics || !runtime?.emitCapacityUpdated) {
      return false;
    }

    const calculated = runtime.recomputeCapacityMetrics(changedFeatureIds);
    if (!onlyIfCalculated || calculated) {
      runtime.emitCapacityUpdated();
    }
    return calculated;
  }

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

  function commitSidebarDisabled(controls) {
    const safeControls = asObject(controls);
    return store.update('selection.sidebarDisabled.command', (draft) => {
      draft.selection.sidebarDisabled = safeControls;
    });
  }

  function commitViewOptions(label, updates) {
    const safeUpdates = asObject(updates);
    return store.update(label, (draft) => {
      draft.view.options = {
        ...asObject(draft.view.options),
        ...safeUpdates,
      };
    });
  }

  function commitFeatureStateSelection(label, states) {
    const nextStates = asArray(states).filter(Boolean);
    return store.update(label, (draft) => {
      draft.selection.featureStateNames = nextStates;
    });
  }

  function commitTaskTypeSelection(label, taskTypeNames) {
    const nextTypes = Array.from(new Set(asArray(taskTypeNames).filter(Boolean)));
    return store.update(label, (draft) => {
      draft.selection.taskTypeNames = nextTypes;
    });
  }

  function readSelectedFeatureStates(runtime) {
    const selectedStates = runtime?.selectedFeatureStateFilter || runtime?.selectedFeatureStates;
    if (selectedStates instanceof Set) return Array.from(selectedStates);
    return asArray(selectedStates);
  }

  function commitFeatureStateSelectionFromRuntime(label, runtime) {
    commitFeatureStateSelection(label, readSelectedFeatureStates(runtime));
  }

  function readSelectedTaskTypeNames(runtime) {
    return asArray(runtime?._store?.getState?.()?.selection?.taskTypeNames).filter(Boolean);
  }

  function normalizeDisplayMode(mode) {
    return mode === 'compact' || mode === 'packed' ? mode : 'normal';
  }

  function normalizeViewOptions(rawViewOptions) {
    const viewOptions = asObject(rawViewOptions);
    const updates = {};

    if (viewOptions.displayMode !== undefined) {
      const normalized = normalizeDisplayMode(viewOptions.displayMode);
      updates.displayMode = normalized;
      if (viewOptions.condensedCards === undefined) {
        updates.condensedCards = normalized !== 'normal';
      }
    }
    if (viewOptions.condensedCards !== undefined) {
      const normalized = !!viewOptions.condensedCards;
      updates.condensedCards = normalized;
      if (viewOptions.displayMode === undefined) {
        updates.displayMode = normalized ? 'compact' : 'normal';
      }
    }
    if (viewOptions.showDependencies !== undefined) {
      updates.showDependencies = !!viewOptions.showDependencies;
    }
    if (viewOptions.showUnplannedWork !== undefined) {
      updates.showUnplannedWork = !!viewOptions.showUnplannedWork;
    }
    if (viewOptions.showUnallocatedCards !== undefined) {
      updates.showUnallocatedCards = !!viewOptions.showUnallocatedCards;
    } else if (viewOptions.showUnassignedCards !== undefined) {
      updates.showUnallocatedCards = !!viewOptions.showUnassignedCards;
    }
    if (viewOptions.showOnlyProjectHierarchy !== undefined) {
      updates.showOnlyProjectHierarchy = !!viewOptions.showOnlyProjectHierarchy;
    }
    if (viewOptions.capacityViewMode === 'team' || viewOptions.capacityViewMode === 'project') {
      updates.capacityViewMode = viewOptions.capacityViewMode;
    }
    if (viewOptions.featureSortMode === 'rank' || viewOptions.featureSortMode === 'date') {
      updates.featureSortMode = viewOptions.featureSortMode;
    }
    if (viewOptions.highlightFeatureRelationMode !== undefined) {
      updates.highlightFeatureRelationMode = !!viewOptions.highlightFeatureRelationMode;
    }

    return updates;
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
    initialize() {},

    destroy() {},

    syncFromLegacyState() {
      const runtime = services?.runtime;
      if (!runtime?.captureSnapshot) return;
      runtime.captureSnapshot('runtime.syncFromLegacyState');
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

    applyViewSelectionRestore(payload = {}) {
      const runtime = services?.runtime;
      if (payload.projectSelections) this.setProjectsSelectedBulk(payload.projectSelections);
      if (payload.teamSelections) this.setTeamsSelectedBulk(payload.teamSelections);
      if (Array.isArray(payload.selectedStates)) {
        runtime?.setSelectedStates?.(payload.selectedStates);
        commitFeatureStateSelection('selection.featureStates.restore.command', payload.selectedStates);
      }
      if (Array.isArray(payload.selectedTaskTypes)) this.setSelectedTaskTypes(payload.selectedTaskTypes);
      if (payload.resetTaskFilters) runtime?.taskFilterService?.resetFilters?.();
      else if (payload.taskFilters) runtime?.taskFilterService?.restoreFilters?.(payload.taskFilters);
      commitTaskTypeSelection(
        'selection.taskTypeNames.restore.command',
        Array.isArray(payload.selectedTaskTypes)
          ? payload.selectedTaskTypes
          : readSelectedTaskTypeNames(runtime)
      );
    },

    planViewRestoreUiEffects(payload = {}) {
      const runtime = services?.runtime;
      if (!runtime) return planViewRestoreUiEffects(payload);

      if (typeof runtime.planViewRestoreUiEffects === 'function') {
        return runtime.planViewRestoreUiEffects(payload);
      }

      return planViewRestoreUiEffects(payload);
    },

    applyViewOptionsRestore(payload = {}) {
      const runtime = services?.runtime;
      const viewOptions = asObject(payload.viewOptions);
      const updates = normalizeViewOptions(viewOptions);

      if (Object.keys(updates).length > 0) {
        commitViewOptions('view.options.restore.command', updates);
      }
      if (Object.keys(viewOptions).length > 0) {
        runtime?.viewService?.restoreView?.(viewOptions);
      }

      if (payload.graphType) this.setCapacityViewMode(payload.graphType);
      if (Array.isArray(payload.selectedTaskTypes)) this.setSelectedTaskTypes(payload.selectedTaskTypes);
      if (payload.expansion) {
        this.setExpansionState(payload.expansion);
        if (payload.emitExpansionFilterChange) {
          runtime?._bus?.emit?.(FilterEvents.CHANGED, {
            expansion: {
              parentChild: !!payload.expansion.expandParentChild,
              relations: !!payload.expansion.expandRelations,
              teamAllocated: !!payload.expansion.expandTeamAllocated,
            },
          });
        }
      }
    },

    async applyViewPluginStateRestore(payload) {
      const runtime = services?.runtime;
      if (!runtime?.applyViewPluginStateRestore) return undefined;
      return runtime.applyViewPluginStateRestore({
        ...(payload || {}),
        logFailures: false,
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

    setSidebarDisabledElements(controls) {
      const safeControls = asObject(controls);
      commitSidebarDisabled(safeControls);
      services?.runtime?.setSidebarDisabledElements?.(safeControls);
    },

    clearSidebarDisabledElements() {
      commitSidebarDisabled({});
      services?.runtime?.clearSidebarDisabledElements?.();
    },

    setSelectedTaskTypes(types) {
      const nextTypes = Array.from(new Set(asArray(types).filter(Boolean)));
      commitTaskTypeSelection('selection.taskTypeNames.command', nextTypes);
      services?.runtime?.setSelectedTaskTypes?.(nextTypes);
    },

    setSelectedStates(states) {
      const runtime = services?.runtime;
      runtime?.setSelectedStates?.(states);
      commitFeatureStateSelectionFromRuntime('selection.featureStates.command', runtime);
    },

    setAvailableFeatureStates(states) {
      services?.runtime?.setAvailableFeatureStates?.(states);
    },

    setAllStatesSelected(selected) {
      const runtime = services?.runtime;
      runtime?.setAllStatesSelected?.(selected);
      commitFeatureStateSelectionFromRuntime('selection.featureStates.selectAll.command', runtime);
    },

    toggleStateSelected(stateName) {
      const runtime = services?.runtime;
      runtime?.toggleStateSelected?.(stateName);
      commitFeatureStateSelectionFromRuntime('selection.featureStates.toggle.command', runtime);
    },

    setStateFilter(stateName) {
      const runtime = services?.runtime;
      runtime?.setStateFilter?.(stateName);
      commitFeatureStateSelectionFromRuntime('selection.featureStates.filter.command', runtime);
    },

    setTimelineScale(scale, suppressEmit) {
      services?.runtime?.setTimelineScale?.(scale, suppressEmit);
    },

    setTypeVisibility(type, visible, suppressEmit) {
      services?.runtime?.setTypeVisibility?.(type, visible, suppressEmit);
    },

    setDisplayMode(mode) {
      commitViewOptions('view.options.displayMode.command', normalizeViewOptions({ displayMode: mode }));
      services?.runtime?.setDisplayMode?.(mode);
    },

    setCondensedCards(condensed) {
      const normalized = !!condensed;
      commitViewOptions(
        'view.options.condensedCards.command',
        normalizeViewOptions({ condensedCards: normalized })
      );
      services?.runtime?.setCondensedCards?.(normalized);
    },

    setShowDependencies(visible) {
      const normalized = !!visible;
      commitViewOptions('view.options.showDependencies.command', {
        showDependencies: normalized,
      });
      services?.runtime?.setShowDependencies?.(normalized);
    },

    setShowUnplannedWork(visible) {
      const normalized = !!visible;
      commitViewOptions('view.options.showUnplannedWork.command', {
        showUnplannedWork: normalized,
      });
      services?.runtime?.setShowUnplannedWork?.(normalized);
    },

    setShowUnallocatedCards(visible) {
      const normalized = !!visible;
      commitViewOptions('view.options.showUnallocatedCards.command', {
        showUnallocatedCards: normalized,
      });
      services?.runtime?.setShowUnallocatedCards?.(normalized);
    },

    setShowOnlyProjectHierarchy(visible) {
      const normalized = !!visible;
      commitViewOptions('view.options.showOnlyProjectHierarchy.command', {
        showOnlyProjectHierarchy: normalized,
      });
      services?.runtime?.setShowOnlyProjectHierarchy?.(normalized);
    },

    setCapacityViewMode(mode) {
      if (mode !== 'team' && mode !== 'project') return;
      commitViewOptions('view.options.capacityViewMode.command', {
        capacityViewMode: mode,
      });
      services?.runtime?.setCapacityViewMode?.(mode);
    },

    setFeatureSortMode(mode) {
      if (mode !== 'rank' && mode !== 'date') return;
      commitViewOptions('view.options.featureSortMode.command', {
        featureSortMode: mode,
      });
      services?.runtime?.setFeatureSortMode?.(mode);
    },

    setHighlightFeatureRelationMode(mode) {
      const normalized = !!mode;
      commitViewOptions('view.options.highlightFeatureRelationMode.command', {
        highlightFeatureRelationMode: normalized,
      });
      services?.runtime?.setHighlightFeatureRelationMode?.(normalized);
    },

    clearPendingGroupChanges() {
      const runtime = services?.runtime;
      if (!runtime?.scenarioGroupService) return false;
      return mutateActiveWritableScenario('scenario.group.clearPending.command', (scenario) => {
        runtime.scenarioGroupService.clearPendingChanges(scenario);
        return true;
      });
    },

    confirmGroupCreate(tempId, realId) {
      const runtime = services?.runtime;
      if (!runtime?.scenarioGroupService) return false;
      return mutateActiveWritableScenario('scenario.group.confirmCreate.command', (scenario) => {
        runtime.scenarioGroupService.confirmCreate(tempId, realId, scenario);
        return true;
      });
    },

    createGroupInScenario(planId, name, color = null, parentId = null) {
      const runtime = services?.runtime;
      if (!runtime?.scenarioGroupService) return null;
      return mutateActiveWritableScenario('scenario.group.create.command', (scenario) =>
        runtime.scenarioGroupService.create(planId, name, color, parentId, scenario)
      );
    },

    updateGroupInScenario(groupId, fields) {
      const runtime = services?.runtime;
      if (!runtime?.scenarioGroupService) return null;
      return mutateActiveWritableScenario('scenario.group.update.command', (scenario) =>
        runtime.scenarioGroupService.update(groupId, fields, scenario)
      );
    },

    deleteGroupInScenario(groupId) {
      const runtime = services?.runtime;
      if (!runtime?.scenarioGroupService) return false;
      return mutateActiveWritableScenario('scenario.group.delete.command', (scenario) => {
        runtime.scenarioGroupService.delete(groupId, scenario);
        return true;
      });
    },

    applyGroupMemberDelta(groupId, taskId, op) {
      const runtime = services?.runtime;
      if (!runtime?.scenarioGroupService) return false;
      return mutateActiveWritableScenario('scenario.group.memberDelta.command', (scenario) => {
        runtime.scenarioGroupService.applyMemberDelta(groupId, taskId, op, scenario);
        return true;
      });
    },

    updateFeatureDates(updates) {
      const runtime = services?.runtime;
      if (!runtime?.featureService) return 0;
      const count = mutateActiveWritableScenario('scenario.featureDates.command', (scenario) =>
        runtime.featureService.updateFeatureDates(updates, undefined, scenario)
      );
      if (count && runtime.getActiveScenario?.()) {
        recomputeRuntimeCapacity();
      }
      return count || 0;
    },

    updateFeatureField(id, field, value) {
      const runtime = services?.runtime;
      if (!runtime?.featureService) return false;
      const updated = mutateActiveWritableScenario('scenario.featureField.command', (scenario) =>
        runtime.featureService.updateFeatureField(id, field, value, undefined, scenario)
      );
      if (!updated) return false;
      if (field === 'start' || field === 'end' || field === 'capacity') {
        recomputeRuntimeCapacity([id]);
      }
      runtime.emitScenarioUpdated?.(runtime.activeScenarioId, {
        type: 'field',
        id,
        field,
      });
      return true;
    },

    updateFeatureRelations(id, relations) {
      const runtime = services?.runtime;
      if (!runtime?.featureService) return false;
      const updated = mutateActiveWritableScenario('scenario.featureRelations.command', (scenario) =>
        runtime.featureService.updateFeatureRelations(id, relations, scenario)
      );
      if (updated) {
        runtime.emitScenarioUpdated?.(runtime.activeScenarioId, {
          type: 'relations',
          id,
        });
      }
      return !!updated;
    },

    revertFeature(id) {
      const runtime = services?.runtime;
      if (!runtime?.featureService) return false;
      const reverted = mutateActiveWritableScenario('scenario.featureRevert.command', (scenario) =>
        runtime.featureService.revertFeature(id, undefined, scenario)
      );
      if (!reverted) return false;
      recomputeRuntimeCapacity([id]);
      runtime.emitScenarioUpdated?.(runtime.activeScenarioId, { type: 'revert', id });
      return true;
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
      const runtime = services?.runtime;
      const scenario = runtime?.buildScenarioClone?.(sourceId, name);
      if (!scenario) return null;
      updateScenarioItems('scenario.clone.command', (items) => [...items, scenario]);
      runtime?.emitScenarioUpdated?.(scenario.id, { type: 'clone', from: sourceId });
      return scenario;
    },

    renameScenario(id, newName) {
      const runtime = services?.runtime;
      const normalized = runtime?.normalizeScenarioName?.(id, newName) ?? newName;
      if (!commitRenameScenario(id, normalized)) return false;
      runtime?.emitScenarioUpdated?.(id, { type: 'rename', name: normalized });
      return true;
    },

    deleteScenario(id) {
      const runtime = services?.runtime;
      const wasActive = selectors?.scenarios?.().activeId === id;
      if (!commitDeleteScenario(id)) return false;
      runtime?.emitScenarioUpdated?.(id, { type: 'delete' });
      runtime?.emitFeatureUpdated?.();
      if (wasActive) runtime?.emitScenarioActivated?.();
      return true;
    },

    async saveScenario(id) {
      const runtime = services?.runtime;
      const scenarios = runtime?.getScenarios?.() || runtime?.scenarios?.list?.() || [];
      const scenario = asArray(scenarios).find((item) => item?.id === id);
      if (!scenario || !runtime?.saveScenarioPayload) {
        return undefined;
      }

      const result = await runtime.saveScenarioPayload(selectScenarioSavePayload(scenario));
      if (!result?.ok) {
        throw new Error(result?.error?.message || 'Failed to save scenario');
      }

      commitSavedScenario(id);
      runtime?.emitScenarioUpdated?.(id, { type: 'saved' });
      return true;
    },
  };
}
