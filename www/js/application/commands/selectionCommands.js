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
    setProjectSelected(id, selected) {
      return state.setProjectSelected(id, selected);
    },

    setTeamSelected(id, selected) {
      return state.setTeamSelected(id, selected);
    },

    setProjectsSelectedBulk(selections, opts) {
      return state.setProjectsSelectedBulk(selections, opts);
    },

    setTeamsSelectedBulk(selections, opts) {
      return state.setTeamsSelectedBulk(selections, opts);
    },

    setProjectColor(id, color) {
      const project = (state.projects || []).find((item) => String(item?.id) === String(id));
      if (project) {
        project.color = color;
      }
    },

    setTeamColor(id, color) {
      const team = (state.teams || []).find((item) => String(item?.id) === String(id));
      if (team) {
        team.color = color;
      }
    },
  };
}

export function createSelectionCommands(store, bus, legacyState) {
  return {
    setProjectSelected(id, selected, options = {}) {
      legacyState?.setProjectSelected?.(id, selected);
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
        bus?.emit?.('selection:project-changed', { id, selected: Boolean(selected) });
      }
    },

    setTeamSelected(id, selected, options = {}) {
      legacyState?.setTeamSelected?.(id, selected);
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
        bus?.emit?.('selection:team-changed', { id, selected: Boolean(selected) });
      }
    },

    setProjectsSelectedBulk(selections, options = {}) {
      legacyState?.setProjectsSelectedBulk?.(selections, options);
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
        bus?.emit?.('selection:projects-bulk-changed', {
          selections: { ...(selections || {}) },
        });
      }
    },

    setTeamsSelectedBulk(selections, options = {}) {
      legacyState?.setTeamsSelectedBulk?.(selections, options);
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
        bus?.emit?.('selection:teams-bulk-changed', {
          selections: { ...(selections || {}) },
        });
      }
    },

    setProjectColor(id, color, options = {}) {
      legacyState?.setProjectColor?.(id, color);
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
      legacyState?.setTeamColor?.(id, color);
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
