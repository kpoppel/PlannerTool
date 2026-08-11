function hasTeamAllocation(feature, selectedTeamIds) {
  const capacities = Array.isArray(feature?.capacity) ? feature.capacity : [];
  for (const entry of capacities) {
    const teamId = entry?.team ?? entry?.teamId ?? entry?.id;
    if (teamId && selectedTeamIds.has(String(teamId))) {
      return true;
    }
  }
  return false;
}

function deriveEffectiveProjectIdsFromStore(state) {
  const rawSelected = Array.from(state?.selection?.projectIds || []).map((id) => String(id));

  if (!state?.view?.expansion?.teamAllocated) {
    return rawSelected;
  }

  const selectedTeams = Array.from(state?.selection?.teamIds || []).map((id) => String(id));
  if (!selectedTeams.length) {
    return rawSelected;
  }

  const selectedTeamIds = new Set(selectedTeams);
  const derived = new Set(rawSelected);
  const features = Array.isArray(state?.baseline?.features) ? state.baseline.features : [];

  for (const feature of features) {
    if (!feature?.project) continue;
    if (hasTeamAllocation(feature, selectedTeamIds)) {
      derived.add(String(feature.project));
    }
  }

  return Array.from(derived);
}

function normalizeIdList(ids) {
  const normalized = [];
  for (const id of ids || []) {
    if (id === null || id === undefined) continue;
    normalized.push(String(id));
  }
  return normalized;
}

function getPreferredSourceItems(legacyItems, baselineItems) {
  if (Array.isArray(legacyItems) && legacyItems.length > 0) {
    return legacyItems;
  }
  return Array.isArray(baselineItems) ? baselineItems : [];
}

function deriveFallbackSelectedIds(items) {
  const list = Array.isArray(items) ? items : [];
  const hasExplicitFlags = list.some((item) => typeof item?.selected === 'boolean');
  const selectedIds = [];

  if (hasExplicitFlags) {
    for (const item of list) {
      if (!item?.selected) continue;
      if (item?.id === null || item?.id === undefined) continue;
      selectedIds.push(String(item.id));
    }
  } else {
    for (const item of list) {
      if (item?.id === null || item?.id === undefined) continue;
      selectedIds.push(String(item.id));
    }
  }

  if (selectedIds.length > 0) {
    return selectedIds;
  }

  return list
    .filter((item) => item?.id !== null && item?.id !== undefined)
    .map((item) => String(item.id));
}

function deriveItemsWithSelection(sourceItems, storeIds) {
  const list = Array.isArray(sourceItems) ? sourceItems : [];
  const normalizedStoreIds = normalizeIdList(storeIds);
  // null = not yet initialized → fall back to selected flags on items
  // [] = explicitly empty (user deselected all) → no fallback
  const selectedIds =
    storeIds === null ? deriveFallbackSelectedIds(list) : normalizedStoreIds;
  const selectedSet = new Set(selectedIds);

  return list.map((item) => ({
    ...item,
    selected: selectedSet.has(String(item?.id)),
  }));
}

function deriveProjectsFromStore(state, legacyState = null) {
  const projects = getPreferredSourceItems(legacyState?.projects, state?.baseline?.projects);
  return deriveItemsWithSelection(projects, state?.selection?.projectIds ?? null);
}

function deriveTeamsFromStore(state, legacyState = null) {
  const teams = getPreferredSourceItems(legacyState?.teams, state?.baseline?.teams);
  return deriveItemsWithSelection(teams, state?.selection?.teamIds ?? null);
}

export function createLegacySelectionSelectors(state) {
  return {
    getEffectiveSelectedProjectIds() {
      if (typeof state.getEffectiveSelectedProjectIds === 'function') {
        return state.getEffectiveSelectedProjectIds();
      }
      return [];
    },

    getSelectedProjectIds() {
      const projects = Array.isArray(state.projects) ? state.projects : [];
      return projects.filter((p) => p.selected).map((p) => p.id);
    },

    getSelectedTeamIds() {
      const teams = Array.isArray(state.teams) ? state.teams : [];
      return teams.filter((t) => t.selected).map((t) => t.id);
    },

    getProjects() {
      return Array.isArray(state.projects) ? state.projects : [];
    },

    getTeams() {
      return Array.isArray(state.teams) ? state.teams : [];
    },

    getSelectedProjects() {
      return this.getProjects().filter((project) => Boolean(project?.selected));
    },

    getSelectedTeams() {
      return this.getTeams().filter((team) => Boolean(team?.selected));
    },

    getProjectById(id) {
      const key = String(id);
      return this.getProjects().find((project) => String(project?.id) === key) || null;
    },

    getTeamById(id) {
      const key = String(id);
      return this.getTeams().find((team) => String(team?.id) === key) || null;
    },
  };
}

export function createSelectionSelectors(store, legacyState = null) {
  return {
    getEffectiveSelectedProjectIds() {
      const state = store.getState();
      const selectedIds = this.getSelectedProjectIds();
      const effective = deriveEffectiveProjectIdsFromStore({
        ...state,
        selection: {
          ...(state?.selection || {}),
          projectIds: selectedIds,
        },
      });
      return effective;
    },

    getSelectedProjectIds() {
      const projectIds = store.getState()?.selection?.projectIds ?? null;
      if (projectIds !== null) {
        return normalizeIdList(projectIds);
      }
      // null = not yet initialized: derive from selected flags on projects
      return this.getProjects()
        .filter((project) => Boolean(project?.selected))
        .map((project) => String(project.id));
    },

    getSelectedTeamIds() {
      const teamIds = store.getState()?.selection?.teamIds ?? null;
      if (teamIds !== null) {
        return normalizeIdList(teamIds);
      }
      // null = not yet initialized: derive from selected flags on teams
      return this.getTeams()
        .filter((team) => Boolean(team?.selected))
        .map((team) => String(team.id));
    },

    getProjects() {
      return deriveProjectsFromStore(store.getState());
    },

    getTeams() {
      return deriveTeamsFromStore(store.getState());
    },

    getSelectedProjects() {
      return this.getProjects().filter((project) => Boolean(project?.selected));
    },

    getSelectedTeams() {
      return this.getTeams().filter((team) => Boolean(team?.selected));
    },

    getProjectById(id) {
      const key = String(id);
      return this.getProjects().find((project) => String(project?.id) === key) || null;
    },

    getTeamById(id) {
      const key = String(id);
      return this.getTeams().find((team) => String(team?.id) === key) || null;
    },
  };
}
