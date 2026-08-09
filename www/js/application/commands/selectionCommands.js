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
  };
}

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
        bus?.emit?.('selection:project-changed', { id, selected: Boolean(selected) });
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
        bus?.emit?.('selection:team-changed', { id, selected: Boolean(selected) });
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
        bus?.emit?.('selection:projects-bulk-changed', {
          selections: { ...(selections || {}) },
        });
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
        bus?.emit?.('selection:teams-bulk-changed', {
          selections: { ...(selections || {}) },
        });
      }
    },
  };
}
