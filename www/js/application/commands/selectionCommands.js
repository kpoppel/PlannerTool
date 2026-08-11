import { ProjectEvents, TeamEvents, FeatureEvents } from '../../core/EventRegistry.js';

function projectsWithSelection(state) {
  const projects = Array.isArray(state?.baseline?.projects) ? state.baseline.projects : [];
  const ids = new Set((state?.selection?.projectIds || []).map((id) => String(id)));
  return projects.map((p) => ({ ...p, selected: ids.has(String(p.id)) }));
}

function teamsWithSelection(state) {
  const teams = Array.isArray(state?.baseline?.teams) ? state.baseline.teams : [];
  const ids = new Set((state?.selection?.teamIds || []).map((id) => String(id)));
  return teams.map((t) => ({ ...t, selected: ids.has(String(t.id)) }));
}

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

export function createLegacySelectionCommands(state) {
  return {
    // setProjectSelected(id, selected) {
    //   return state.setProjectSelected(id, selected);
    // },

    // setTeamSelected(id, selected) {
    //   return state.setTeamSelected(id, selected);
    // },

    // setProjectsSelectedBulk(selections, opts) {
    //   return state.setProjectsSelectedBulk(selections, opts);
    // },

    // setTeamsSelectedBulk(selections, opts) {
    //   return state.setTeamsSelectedBulk(selections, opts);
    // },

    // setProjectColor(id, color) {
    //   const project = (state.projects || []).find((item) => String(item?.id) === String(id));
    //   if (project) {
    //     project.color = color;
    //   }
    // },

    // setTeamColor(id, color) {
    //   const team = (state.teams || []).find((item) => String(item?.id) === String(id));
    //   if (team) {
    //     team.color = color;
    //   }
    // },
  };
}

export function createSelectionCommands(store, bus, recomputeCapacity = null) {
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
      if (recomputeCapacity) {
        recomputeCapacity();
      }
      if (!options?.suppressEvents) {
        bus?.emit?.(ProjectEvents.CHANGED, projectsWithSelection(store.getState()));
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
      if (recomputeCapacity) {
        recomputeCapacity();
      }
      if (!options?.suppressEvents) {
        bus?.emit?.(TeamEvents.CHANGED, teamsWithSelection(store.getState()));
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
      if (recomputeCapacity) {
        recomputeCapacity();
      }
      if (!options?.suppressEvents) {
        bus?.emit?.(ProjectEvents.CHANGED, projectsWithSelection(store.getState()));
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
      if (recomputeCapacity) {
        recomputeCapacity();
      }
      if (!options?.suppressEvents) {
        bus?.emit?.(TeamEvents.CHANGED, teamsWithSelection(store.getState()));
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
