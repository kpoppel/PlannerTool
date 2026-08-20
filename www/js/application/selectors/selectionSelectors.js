import { hasFeatureTeamAllocation } from '../shared/teamAllocation.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

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


/**
 * @param {StoreApi} store
 * @returns {object}
 */
export function createSelectionSelectors(store) {
  const selectors = {
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
      return selectors.getProjects().filter((project) => Boolean(project.selected));
    },

    getSelectedTeams() {
      return selectors.getTeams().filter((team) => Boolean(team.selected));
    },

    getProjectById(id) {
      const key = String(id);
      const project = selectors.getProjects().find((item) => item && String(item.id) === key);
      return project;
    },

    getTeamById(id) {
      const key = String(id);
      const team = selectors.getTeams().find((item) => item && String(item.id) === key);
      return team;
    },
  };

  return selectors;
}
