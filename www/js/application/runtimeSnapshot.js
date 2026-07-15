function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJsonLike(value) {
  if (Array.isArray(value)) return value.map(cloneJsonLike);
  if (value instanceof Set) return Array.from(value).map(cloneJsonLike);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonLike(child)])
  );
}

function toSelectionIds(items) {
  return asArray(items)
    .filter((item) => item?.selected)
    .map((item) => item.id)
    .filter(Boolean);
}

function readTaskFilters(runtime) {
  return cloneJsonLike(asObject(runtime?.taskFilterService?.getFilters?.()));
}

function readSelectedTaskTypes(runtime) {
  return cloneJsonLike(asArray(runtime?._store?.getState?.()?.selection?.taskTypeNames));
}

function readViewOptions(runtime) {
  return {
    displayMode: runtime?.displayMode || 'normal',
    condensedCards: !!runtime?.condensedCards,
    showDependencies: !!runtime?.showDependencies,
    showUnplannedWork: !!runtime?.showUnplannedWork,
    showUnallocatedCards: !!runtime?.showUnallocatedCards,
    showOnlyProjectHierarchy: !!runtime?.showOnlyProjectHierarchy,
    capacityViewMode: runtime?.capacityViewMode || 'project',
    featureSortMode: runtime?.featureSortMode || 'rank',
    highlightFeatureRelationMode: runtime?.highlightFeatureRelationMode || 'none',
  };
}

function readExpansion(runtime) {
  const expansion = asObject(runtime?.expansionState);
  return {
    parentChild: !!expansion.expandParentChild,
    relations: !!expansion.expandRelations,
    teamAllocated: !!expansion.expandTeamAllocated,
  };
}

function readScenarios(runtime) {
  return {
    activeId: runtime?.activeScenarioId || null,
    items: cloneJsonLike(asArray(runtime?.scenarios?.list?.())),
  };
}

function readViews(runtime) {
  return {
    activeId: runtime?.views?.getActiveId?.() || runtime?.activeViewId || null,
    saved: cloneJsonLike(asArray(runtime?.views?.list?.() || runtime?.savedViews)),
  };
}

function readCapacity(runtime) {
  const canonical = runtime?._store?.getState?.()?.capacity;
  if (canonical) {
    return {
      dates: cloneJsonLike(asArray(canonical.dates)),
      teamDaily: cloneJsonLike(asArray(canonical.teamDaily)),
      teamDailyMap: cloneJsonLike(asArray(canonical.teamDailyMap)),
      projectDailyRaw: cloneJsonLike(asArray(canonical.projectDailyRaw)),
      projectDaily: cloneJsonLike(asArray(canonical.projectDaily)),
      projectDailyMap: cloneJsonLike(asArray(canonical.projectDailyMap)),
      organizationDaily: cloneJsonLike(asArray(canonical.organizationDaily)),
      organizationDailyPerTeamAverage: cloneJsonLike(
        asArray(canonical.organizationDailyPerTeamAverage)
      ),
    };
  }

  return {
    dates: cloneJsonLike(asArray(runtime?.capacityDates)),
    teamDaily: cloneJsonLike(asArray(runtime?.teamDailyCapacity)),
    teamDailyMap: cloneJsonLike(asArray(runtime?.teamDailyCapacityMap)),
    projectDailyRaw: cloneJsonLike(asArray(runtime?.projectDailyCapacityRaw)),
    projectDaily: cloneJsonLike(asArray(runtime?.projectDailyCapacity)),
    projectDailyMap: cloneJsonLike(asArray(runtime?.projectDailyCapacityMap)),
    organizationDaily: cloneJsonLike(asArray(runtime?.totalOrgDailyCapacity)),
    organizationDailyPerTeamAverage: cloneJsonLike(asArray(runtime?.totalOrgDailyPerTeamAvg)),
  };
}

function readFeatureStates(runtime) {
  if (runtime?.selectedFeatureStates instanceof Set) {
    return Array.from(runtime.selectedFeatureStates);
  }
  if (runtime?.selectedFeatureStateFilter instanceof Set) {
    return Array.from(runtime.selectedFeatureStateFilter);
  }
  return asArray(runtime?.selectedFeatureStates || runtime?.selectedFeatureStateFilter);
}

function readSidebarDisabled(runtime) {
  return cloneJsonLike(asObject(runtime?.getSidebarDisabledElements?.()));
}

export function buildRuntimeSnapshot(runtime) {
  const projects = cloneJsonLike(asArray(runtime?.projects));
  const teams = cloneJsonLike(asArray(runtime?.teams));

  return Object.freeze({
    baseline: Object.freeze({
      projects,
      teams,
      features: cloneJsonLike(asArray(runtime?.baselineFeatures)),
      iterationsByProject: cloneJsonLike(asObject(runtime?.iterations)),
    }),
    scenarios: Object.freeze(readScenarios(runtime)),
    selection: Object.freeze({
      projectIds: toSelectionIds(projects),
      teamIds: toSelectionIds(teams),
      featureStateNames: cloneJsonLike(readFeatureStates(runtime)),
      taskFilters: readTaskFilters(runtime),
      taskTypeNames: cloneJsonLike(readSelectedTaskTypes(runtime)),
      sidebarDisabled: readSidebarDisabled(runtime),
    }),
    view: Object.freeze({
      ...readViews(runtime),
      options: Object.freeze(readViewOptions(runtime)),
      expansion: Object.freeze(readExpansion(runtime)),
    }),
    capacity: Object.freeze(readCapacity(runtime)),
  });
}

export function publishRuntimeSnapshot(store, snapshot, label, options = {}) {
  store.update(label, (draft) => {
    draft.baseline.revision += 1;
    draft.baseline.projects = snapshot.baseline.projects;
    draft.baseline.teams = snapshot.baseline.teams;
    draft.baseline.features = snapshot.baseline.features;
    draft.baseline.iterationsByProject = snapshot.baseline.iterationsByProject;

    draft.scenarios = snapshot.scenarios;
    draft.selection = { ...draft.selection, ...snapshot.selection };

    draft.view.activeId = snapshot.view.activeId;
    draft.view.saved = snapshot.view.saved;
    draft.view.options = snapshot.view.options;
    draft.view.expansion = snapshot.view.expansion;

    draft.capacity = snapshot.capacity;
  });
}

export function syncRuntimeSnapshot(store, runtime, label, options = {}) {
  const snapshot = buildRuntimeSnapshot(runtime);
  publishRuntimeSnapshot(store, snapshot, label, options);
  return snapshot;
}

export function planViewRestoreUiEffects(payload = {}) {
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