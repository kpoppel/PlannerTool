import {
  selectExpandedFeatureIds,
  selectEffectiveSelectedProjectIds,
} from './expansionSelectors.js';
import {
  selectAvailableTaskTypes,
  selectTaskTypeHierarchy,
  selectTaskTypeDisplayName,
  selectTaskTypeLevel,
  selectOrderedTaskTypes,
} from './taskTypeSelectors.js';
import { selectCapacityEventPayload, selectCapacitySnapshot } from './capacitySelectors.js';
import { selectActiveScenario, selectActiveWritableScenario } from './scenarioSelectors.js';
import { selectIterationsForProject } from './iterationSelectors.js';
import { selectFeatureDirtyMetadata } from './featureSelectors.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function withSelectedFlag(items, selectedIds) {
  const selected = new Set(asArray(selectedIds));
  return asArray(items).map((item) => ({
    ...item,
    selected: selected.has(item?.id),
  }));
}

function readExpansionState(state) {
  const expansion = asObject(state?.view?.expansion);
  return {
    expandParentChild: !!expansion.parentChild,
    expandRelations: !!expansion.relations,
    expandTeamAllocated: !!expansion.teamAllocated,
  };
}

export function createPlannerSelectors({ store }) {
  const getState = () => store.getState();
  const getScenarios = () => asArray(getState().scenarios?.items);
  const getActiveScenarioId = () => getState().scenarios?.activeId || null;

  return {
    state: getState,
    lifecycle: () => getState().lifecycle,

    projects: () => withSelectedFlag(getState().baseline.projects, getState().selection.projectIds),
    teams: () => withSelectedFlag(getState().baseline.teams, getState().selection.teamIds),
    features: () => asArray(getState().baseline.features),

    selectedProjectIds: () => asArray(getState().selection.projectIds),
    selectedTeamIds: () => asArray(getState().selection.teamIds),

    expandedFeatureIds: () => {
      const state = getState();
      return selectExpandedFeatureIds({
        projects: withSelectedFlag(state.baseline.projects, state.selection.projectIds),
        teams: withSelectedFlag(state.baseline.teams, state.selection.teamIds),
        features: state.baseline.features,
        expansion: readExpansionState(state),
      });
    },

    effectiveSelectedProjectIds: () => {
      const state = getState();
      const projects = withSelectedFlag(state.baseline.projects, state.selection.projectIds);
      const teams = withSelectedFlag(state.baseline.teams, state.selection.teamIds);
      return selectEffectiveSelectedProjectIds({
        projects,
        teams,
        features: state.baseline.features,
        expandTeamAllocated: !!state?.view?.expansion?.teamAllocated,
      });
    },

    availableTaskTypes: () => selectAvailableTaskTypes(getState().baseline.features),
    taskTypeHierarchy: () => selectTaskTypeHierarchy(getState().baseline.projects),
    orderedTaskTypes: () => {
      const state = getState();
      const available = selectAvailableTaskTypes(state.baseline.features);
      const hierarchy = selectTaskTypeHierarchy(state.baseline.projects);
      return selectOrderedTaskTypes(available, hierarchy);
    },
    taskTypeDisplayName: (type) => {
      const hierarchy = selectTaskTypeHierarchy(getState().baseline.projects);
      return selectTaskTypeDisplayName(hierarchy, type);
    },
    taskTypeLevel: (type) => {
      const hierarchy = selectTaskTypeHierarchy(getState().baseline.projects);
      return selectTaskTypeLevel(hierarchy, type);
    },

    activeScenario: () => selectActiveScenario(getScenarios(), getActiveScenarioId()),
    activeWritableScenario: () =>
      selectActiveWritableScenario(getScenarios(), getActiveScenarioId()),

    iterationsForProject: (projectId) =>
      selectIterationsForProject(getState().baseline.iterationsByProject, projectId),

    capacitySnapshot: () => selectCapacitySnapshot(getState().capacity),
    capacityEventPayload: () => selectCapacityEventPayload(getState().capacity),
    featureDirtyMetadata: (featureBase, override) =>
      selectFeatureDirtyMetadata(featureBase, override),
    scenarios: () => getState().scenarios,
    view: () => getState().view,
    selection: () => getState().selection,
  };
}
