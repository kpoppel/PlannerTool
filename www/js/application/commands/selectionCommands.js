import { ProjectEvents, TeamEvents, FeatureEvents } from '../../core/EventRegistry.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */

function nextIds(currentIds, id, selected) {
  const set = new Set(Array.isArray(currentIds) ? currentIds : []);
  if (selected) set.add(id);
  else set.delete(id);
  return Array.from(set);
}

function nextIdsFromBulkSelections(selections) {
  return Object.entries(selections || {})
    .filter(([, selected]) => Boolean(selected))
    .map(([id]) => id);
}

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @returns {object}
 */
export function createSelectionCommands(store, bus) {
  return {
    setProjectSelected(id, selected, options = {}) {
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            projectIds: nextIds(state.selection.projectIds, id, selected),
          },
        }),
        false,
        'selection.setProjectSelected'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.(ProjectEvents.CHANGED);
        bus?.emit?.(FeatureEvents.UPDATED);
      }
    },

    setTeamSelected(id, selected, options = {}) {
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            teamIds: nextIds(state.selection.teamIds, id, selected),
          },
        }),
        false,
        'selection.setTeamSelected'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.(TeamEvents.CHANGED);
        bus?.emit?.(FeatureEvents.UPDATED);
      }
    },

    setProjectsSelectedBulk(selections, options = {}) {
      const projectIds = nextIdsFromBulkSelections(selections);
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            projectIds,
          },
        }),
        false,
        'selection.setProjectsSelectedBulk'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.(ProjectEvents.CHANGED);
        bus?.emit?.(FeatureEvents.UPDATED);
      }
    },

    setTeamsSelectedBulk(selections, options = {}) {
      const teamIds = nextIdsFromBulkSelections(selections);
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            teamIds,
          },
        }),
        false,
        'selection.setTeamsSelectedBulk'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.(TeamEvents.CHANGED);
        bus?.emit?.(FeatureEvents.UPDATED);
      }
    },

    setProjectColor(id, color, options = {}) {
      store.setState(
        (state) => ({
          ...state,
          baseline: {
            ...state.baseline,
            projects: (state.baseline?.projects || []).map((project) =>
              String(project?.id) === String(id) ? { ...project, color } : project
            ),
          },
        }),
        false,
        'selection.setProjectColor'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.('selection:project-color-changed', { id, color });
      }
    },

    setTeamColor(id, color, options = {}) {
      store.setState(
        (state) => ({
          ...state,
          baseline: {
            ...state.baseline,
            teams: (state.baseline?.teams || []).map((team) =>
              String(team?.id) === String(id) ? { ...team, color } : team
            ),
          },
        }),
        false,
        'selection.setTeamColor'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.('selection:team-color-changed', { id, color });
      }
    },
  };
}
