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
  };
}

export function createSelectionSelectors(store) {
  return {
    getEffectiveSelectedProjectIds() {
      return deriveEffectiveProjectIdsFromStore(store.getState());
    },

    getSelectedProjectIds() {
      return Array.from(store.getState()?.selection?.projectIds || []);
    },

    getSelectedTeamIds() {
      return Array.from(store.getState()?.selection?.teamIds || []);
    },
  };
}
