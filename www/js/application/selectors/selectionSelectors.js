import { hasFeatureTeamAllocation } from '../shared/teamAllocation.js';

function deriveEffectiveProjectIdsFromStore(state) {
  const rawSelected = state.selection.projectIds.map((id) => String(id));

  if (!state.view.expansion.teamAllocated) {
    return rawSelected;
  }

  const selectedTeams = state.selection.teamIds.map((id) => String(id));
  if (!selectedTeams.length) {
    return rawSelected;
  }

  const selectedTeamIds = new Set(selectedTeams);
  const derived = new Set(rawSelected);

  for (const feature of state.baseline.features) {
    if (!feature.project) continue;
    if (hasFeatureTeamAllocation(feature, selectedTeamIds)) {
      derived.add(String(feature.project));
    }
  }

  return Array.from(derived);
}

function deriveItemsWithSelection(sourceItems, storeIds) {
  const list = Array.isArray(sourceItems) ? sourceItems : [];
  const selectedSet = new Set(
    Array.isArray(storeIds) ? storeIds.map((id) => String(id)) : []
  );

  return list.map((item) => ({
    ...item,
    selected: selectedSet.has(String(item.id)),
  }));
}

function deriveProjectsFromStore(state) {
  const baselineProjects = state.baseline.projects;
  const selectedProjectIds = state.selection.projectIds;
  return deriveItemsWithSelection(baselineProjects, selectedProjectIds);
}

function deriveTeamsFromStore(state) {
  const baselineTeams = state.baseline.teams;
  const selectedTeamIds = state.selection.teamIds;
  return deriveItemsWithSelection(baselineTeams, selectedTeamIds);
}


export function createSelectionSelectors(store) {
  return {
    getEffectiveSelectedProjectIds() {
      const state = store.getState();
      return deriveEffectiveProjectIdsFromStore(state);
    },

    getSelectedProjectIds() {
      const state = store.getState();
      return state.selection.projectIds.map((id) => String(id));
    },

    getSelectedTeamIds() {
      const state = store.getState();
      return state.selection.teamIds.map((id) => String(id));
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
