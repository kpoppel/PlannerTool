import { featureFlags } from '../config.js';

export function isUnplannedFeature(feature) {
  return !feature?.start || !feature?.end;
}

export function buildChildrenMap(features = []) {
  const childrenMap = new Map();
  for (const feature of features) {
    if (!feature?.parentId) continue;
    const parentId = String(feature.parentId);
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId).push(feature);
  }
  return childrenMap;
}

function isHierarchicallyLinkedToSelectedProjectEpics(
  feature,
  allFeatures,
  selectedProjectEpicIds,
  visited = new Set()
) {
  if (!feature) return false;
  const id = String(feature.id);
  if (visited.has(id)) return false;
  visited.add(id);
  if (selectedProjectEpicIds.has(id)) return true;

  if (feature.parentId) {
    const parent = allFeatures.find((f) => String(f.id) === String(feature.parentId));
    if (
      parent &&
      isHierarchicallyLinkedToSelectedProjectEpics(
        parent,
        allFeatures,
        selectedProjectEpicIds,
        visited
      )
    ) {
      return true;
    }
  }

  if (Array.isArray(feature.relations)) {
    const parentRel = feature.relations.find((r) => r.type === 'Parent');
    if (parentRel?.id) {
      const parent = allFeatures.find((f) => String(f.id) === String(parentRel.id));
      if (
        parent &&
        isHierarchicallyLinkedToSelectedProjectEpics(
          parent,
          allFeatures,
          selectedProjectEpicIds,
          visited
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function normalizeStateFilter(selectedFeatureStateFilter) {
  const stateFilter =
    selectedFeatureStateFilter instanceof Set ?
      selectedFeatureStateFilter
    : Array.isArray(selectedFeatureStateFilter) ?
      new Set(selectedFeatureStateFilter.filter(Boolean))
    : selectedFeatureStateFilter ?
      new Set([selectedFeatureStateFilter])
    : new Set();
  const stateFilterLower = new Set(
    Array.from(stateFilter).map((s) => String(s).toLowerCase())
  );
  return { stateFilter, stateFilterLower };
}

function readSelectionList(state, key) {
  if (key === 'projects') {
    return state?.selection?.getProjects?.() || [];
  }
  if (key === 'teams') {
    return state?.selection?.getTeams?.() || [];
  }
  return [];
}

function readSelectedFeatureStates(state) {
  const namespaced = state?.filters?.getFeatureStates?.();
  if (Array.isArray(namespaced)) return new Set(namespaced.filter(Boolean));

  return new Set();
}

function readExpansionState(state) {
  const namespaced = state?.selection?.getExpansionState?.();
  if (namespaced && typeof namespaced === 'object') {
    return {
      expandParentChild: !!namespaced.expandParentChild,
      expandRelations: !!namespaced.expandRelations,
      expandTeamAllocated: !!namespaced.expandTeamAllocated,
    };
  }

  return {
    expandParentChild: false,
    expandRelations: false,
    expandTeamAllocated: false,
  };
}

function readExpandedIds(state, hasExpansion, expandedIdsOverride) {
  if (expandedIdsOverride) {
    return expandedIdsOverride instanceof Set ? expandedIdsOverride : new Set(expandedIdsOverride);
  }
  if (!hasExpansion) return null;

  const namespaced = state?.selection?.getExpandedFeatureIds?.();
  if (namespaced instanceof Set) return namespaced;
  if (Array.isArray(namespaced)) return new Set(namespaced);

  return null;
}

export function buildFeatureVisibilityContext({
  state,
  allFeatures = [],
  childrenMap = null,
  expandedIdsOverride = null,
}) {
  const projects = readSelectionList(state, 'projects');
  const teams = readSelectionList(state, 'teams');
  const expansionState = readExpansionState(state);
  const hasExpansion =
    !!expansionState.expandParentChild ||
    !!expansionState.expandRelations ||
    !!expansionState.expandTeamAllocated;

  const selectedProjectIds = new Set(
    projects.filter((p) => p?.selected).map((p) => String(p.id))
  );
  const selectedTeamIds = new Set(
    teams.filter((t) => t?.selected).map((t) => String(t.id))
  );

  const normalizedFilter = normalizeStateFilter(readSelectedFeatureStates(state));
  const map = childrenMap || buildChildrenMap(allFeatures);
  const viewService = {
    showOnlyProjectHierarchy: state?.view?.getShowOnlyProjectHierarchy?.() ?? false,
    showUnplannedWork: state?.view?.getShowUnplannedWork?.() ?? false,
    showUnassignedCards: state?.view?.getShowUnallocatedCards?.() ?? false,
    hiddenTypes: new Set(state?.view?.getHiddenTypes?.() ?? []),
    isTypeVisible: (type) => state?.taskTypes?.isVisible?.(type) ?? true,
  };

  let projectTypeEpicIds = null;
  if (viewService?.showOnlyProjectHierarchy) {
    const projectTypePlanIds = new Set(
      projects
        .filter((p) => {
          const planType = p?.type ? String(p.type) : 'project';
          return p?.selected && planType === 'project';
        })
        .map((p) => String(p.id))
    );
    projectTypeEpicIds = new Set(
      allFeatures
        .filter((f) => !f?.parentId && projectTypePlanIds.has(String(f.project)))
        .map((f) => String(f.id))
    );
  }

  const expandedIds = readExpandedIds(state, hasExpansion, expandedIdsOverride);

  return {
    state,
    viewService,
    allFeatures,
    childrenMap: map,
    hasExpansion,
    expandedIds,
    selectedProjectIds,
    selectedTeamIds,
    stateFilter: normalizedFilter.stateFilter,
    stateFilterLower: normalizedFilter.stateFilterLower,
    projectTypeEpicIds,
  };
}

export function featurePassesFilters(feature, ctx) {
  if (!feature || !ctx || !ctx.viewService) return false;

  if (ctx.hasExpansion) {
    if (!ctx.expandedIds || !ctx.expandedIds.has(feature.id)) return false;
  } else if (!ctx.selectedProjectIds.has(String(feature.project))) {
    return false;
  }

  if (ctx.viewService.showOnlyProjectHierarchy) {
    if (
      !isHierarchicallyLinkedToSelectedProjectEpics(
        feature,
        ctx.allFeatures,
        ctx.projectTypeEpicIds || new Set()
      )
    ) {
      return false;
    }
  }

  if (ctx.stateFilter.size === 0) return false;
  if (!ctx.stateFilterLower.has((feature.state || '').toLowerCase())) return false;

  if (
    ctx.state?.taskFilterService &&
    !ctx.state.taskFilterService.featurePassesFilters(feature)
  ) {
    return false;
  }

  if (!ctx.viewService.isTypeVisible(feature.type)) return false;

  if (featureFlags.SHOW_UNPLANNED_WORK) {
    if (isUnplannedFeature(feature) && !ctx.viewService.showUnplannedWork) {
      return false;
    }
  }

  if (ctx.childrenMap.has(String(feature.id))) {
    const children = ctx.childrenMap.get(String(feature.id)) || [];
    const anyChildVisible = children.some((child) => {
      const childProjectSelected = ctx.selectedProjectIds.has(String(child.project));
      if (
        featureFlags.SHOW_UNPLANNED_WORK &&
        isUnplannedFeature(child) &&
        !ctx.viewService.showUnplannedWork
      ) {
        return false;
      }
      const hasCapacity = child.capacity?.length > 0;
      if (!hasCapacity) return childProjectSelected && ctx.viewService.showUnassignedCards;
      if (childProjectSelected) return true;
      return child.capacity.some((tl) => ctx.selectedTeamIds.has(String(tl.team)));
    });

    const hasCapacity = feature.capacity?.length > 0;
    const epicVisible =
      hasCapacity ?
        ctx.selectedProjectIds.has(String(feature.project)) ||
        feature.capacity.some((tl) => ctx.selectedTeamIds.has(String(tl.team)))
      : ctx.selectedProjectIds.has(String(feature.project)) &&
        ctx.viewService.showUnassignedCards;

    if (!epicVisible && !anyChildVisible) return false;
  } else {
    const hasCapacity = feature.capacity?.length > 0;
    if (!hasCapacity) {
      if (
        !ctx.selectedProjectIds.has(String(feature.project)) ||
        !ctx.viewService.showUnassignedCards
      ) {
        return false;
      }
    } else if (
      !(
        ctx.selectedProjectIds.has(String(feature.project)) ||
        feature.capacity.some((tl) => ctx.selectedTeamIds.has(String(tl.team)))
      )
    ) {
      return false;
    }
  }

  return true;
}

export function getVisibleFeatures(features = [], ctx) {
  return features.filter((f) => featurePassesFilters(f, ctx));
}

export function buildVisibilityDiagnostics({ state, allFeatures = [], context = null }) {
  const ctx = context || buildFeatureVisibilityContext({ state, allFeatures });
  const visibleFeatures = getVisibleFeatures(allFeatures, ctx);
  const reasons = [];
  const selectedPlanFeatures = allFeatures.filter((f) =>
    ctx.selectedProjectIds.has(String(f?.project))
  );

  if (ctx.selectedProjectIds.size === 0) {
    reasons.push('No projects/plans selected. Select one or more projects to display tasks.');
  } else if (selectedPlanFeatures.length === 0) {
    reasons.push('Selected projects/plans have no tasks associated.');
  }
  if (ctx.stateFilter.size === 0) {
    reasons.push('Feature state filter excludes all states (no state selected).');
  }

  const availableTypesRaw = state?.availableTaskTypes || [];
  const availableTypes = availableTypesRaw.length > 0 ? availableTypesRaw : ['epic', 'feature'];
  const hiddenTypes = ctx.viewService?.hiddenTypes || new Set();
  const allHidden = availableTypes.every((t) => hiddenTypes.has(t));
  if (allHidden) {
    reasons.push('All task types are hidden in view options.');
  } else {
    for (const t of availableTypes.filter((type) => hiddenTypes.has(type))) {
      reasons.push(`${t.charAt(0).toUpperCase() + t.slice(1)}s are hidden in view options.`);
    }
  }

  const visibleTypes = availableTypes.filter((t) => !hiddenTypes.has(t));
  if (visibleTypes.length > 0) {
    const visibleTypeSet = new Set(visibleTypes.map((t) => String(t).toLowerCase()));
    const typeScope = selectedPlanFeatures.length > 0 ? selectedPlanFeatures : allFeatures;
    const hasTasksForVisibleTypes = typeScope.some((f) =>
      visibleTypeSet.has(String(f?.type || '').toLowerCase())
    );
    if (!hasTasksForVisibleTypes) {
      reasons.push('Selected task types have no tasks associated.');
    }
  }

  if (featureFlags.SHOW_UNPLANNED_WORK && !ctx.viewService.showUnplannedWork) {
    reasons.push('Unplanned work is hidden (unplanned features filtered out).');
  }

  if ((state?.teams || []).length > 0 && ctx.selectedTeamIds.size === 0) {
    reasons.push('No teams selected — capacity-based filtering may exclude tasks.');
  }

  if (
    ctx.selectedTeamIds.size > 0 &&
    ctx.selectedProjectIds.size === 0 &&
    !ctx.hasExpansion
  ) {
    reasons.push(
      "Only teams selected and 'Team Allocated' expansion is disabled — enable the expansion or select projects to show team-allocated tasks."
    );
  }

  const taskFilters = state?.taskFilterService?.getFilters?.() || null;
  if (taskFilters) {
    Object.keys(taskFilters).forEach((dim) => {
      const opts = taskFilters[dim];
      if (Object.keys(opts).every((k) => !opts[k])) {
        reasons.push(
          `${dim.charAt(0).toUpperCase() + dim.slice(1)} filter excludes all options.`
        );
      }
    });
  }

  if (ctx.viewService.showOnlyProjectHierarchy) {
    reasons.push('Hierarchy filter enabled — only epics from selected project-type plans are shown.');
  }

  if (reasons.length === 0) {
    reasons.push('No tasks match the current filters and view options.');
  }

  return {
    visibleFeatures,
    hasVisibleFeatures: visibleFeatures.length > 0,
    reasons,
  };
}