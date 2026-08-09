function mergedExpansion(current, incoming = {}) {
  return {
    parentChild:
      incoming.expandParentChild !== undefined ?
        Boolean(incoming.expandParentChild)
      : Boolean(current?.parentChild),
    relations:
      incoming.expandRelations !== undefined ?
        Boolean(incoming.expandRelations)
      : Boolean(current?.relations),
    teamAllocated:
      incoming.expandTeamAllocated !== undefined ?
        Boolean(incoming.expandTeamAllocated)
      : Boolean(current?.teamAllocated),
  };
}

function toUniqueStringArray(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function getLegacyViewService(state) {
  return state?._viewService;
}

export function createLegacyViewCommands(state) {
  return {
    setExpansionState(options, runtimeOptions) {
      return state.setExpansionState(options, runtimeOptions);
    },

    setTimelineScale(scale) {
      return getLegacyViewService(state)?.setTimelineScale?.(scale);
    },

    setCondensedCards(condensed) {
      return getLegacyViewService(state)?.setCondensedCards?.(Boolean(condensed));
    },

    setFeatureSortMode(mode) {
      return getLegacyViewService(state)?.setFeatureSortMode?.(mode);
    },

    setCapacityViewMode(mode) {
      return getLegacyViewService(state)?.setCapacityViewMode?.(mode);
    },

    setDisplayMode(mode) {
      return getLegacyViewService(state)?.setDisplayMode?.(mode);
    },

    setShowDependencies(showDependencies) {
      return getLegacyViewService(state)?.setShowDependencies?.(
        Boolean(showDependencies)
      );
    },

    setTypeVisibility(typeName, visible, runtimeOptions) {
      return getLegacyViewService(state)?.setTypeVisibility?.(
        typeName,
        Boolean(visible),
        Boolean(runtimeOptions?.suppressEvents)
      );
    },
  };
}

export function createViewCommands(store, bus, legacyState) {
  function setViewOptions(updater, actionName) {
    store.setState(
      (state) => ({
        ...state,
        view: {
          ...state.view,
          options: updater(state.view?.options || {}),
        },
      }),
      false,
      actionName
    );
  }

  return {
    setExpansionState(options, runtimeOptions = {}) {
      legacyState?.setExpansionState?.(options, runtimeOptions);
      store.setState(
        (state) => ({
          ...state,
          view: {
            ...state.view,
            expansion: mergedExpansion(state.view?.expansion, options),
          },
        }),
        false,
        'view.setExpansionState'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus?.emit?.('view:expansion-changed', { options: options || {} });
      }
    },

    setTimelineScale(scale, runtimeOptions = {}) {
      getLegacyViewService(legacyState)?.setTimelineScale?.(scale);
      setViewOptions(
        (options) => ({
          ...options,
          timelineScale: scale,
        }),
        'view.setTimelineScale'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus?.emit?.('view:timeline-scale-changed', { scale });
      }
    },

    setCondensedCards(condensed, runtimeOptions = {}) {
      getLegacyViewService(legacyState)?.setCondensedCards?.(Boolean(condensed));
      setViewOptions(
        (options) => ({
          ...options,
          condensedCards: Boolean(condensed),
            displayMode: condensed ? 'compact' : 'normal',
            packedMode: false,
        }),
        'view.setCondensedCards'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus?.emit?.('view:condensed-cards-changed', { condensed: Boolean(condensed) });
      }
    },

    setFeatureSortMode(mode, runtimeOptions = {}) {
      getLegacyViewService(legacyState)?.setFeatureSortMode?.(mode);
      setViewOptions(
        (options) => ({
          ...options,
          featureSortMode: mode,
        }),
        'view.setFeatureSortMode'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus?.emit?.('view:feature-sort-mode-changed', { mode });
      }
    },

    setCapacityViewMode(mode, runtimeOptions = {}) {
      getLegacyViewService(legacyState)?.setCapacityViewMode?.(mode);
      setViewOptions(
        (options) => ({
          ...options,
          capacityViewMode: mode,
        }),
        'view.setCapacityViewMode'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus?.emit?.('view:capacity-view-mode-changed', { mode });
      }
    },

    setDisplayMode(mode, runtimeOptions = {}) {
      getLegacyViewService(legacyState)?.setDisplayMode?.(mode);
      const packedMode = mode === 'packed';
        const condensedCards = mode !== 'normal';
      setViewOptions(
        (options) => ({
          ...options,
          displayMode: mode,
          packedMode,
            condensedCards,
        }),
        'view.setDisplayMode'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus?.emit?.('view:display-mode-changed', { mode });
      }
    },

    setShowDependencies(showDependencies, runtimeOptions = {}) {
      getLegacyViewService(legacyState)?.setShowDependencies?.(Boolean(showDependencies));
      const value = Boolean(showDependencies);
      setViewOptions(
        (options) => ({
          ...options,
          showDependencies: value,
        }),
        'view.setShowDependencies'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus?.emit?.('view:show-dependencies-changed', { showDependencies: value });
      }
    },

    setTypeVisibility(typeName, visible, runtimeOptions = {}) {
      getLegacyViewService(legacyState)?.setTypeVisibility?.(
        typeName,
        Boolean(visible),
        Boolean(runtimeOptions?.suppressEvents)
      );
      const key = String(typeName);
      const shouldShow = Boolean(visible);
      setViewOptions(
        (options) => {
          const currentHidden = toUniqueStringArray(options.hiddenTypes || []);
          const hiddenSet = new Set(currentHidden);
          if (shouldShow) hiddenSet.delete(key);
          else hiddenSet.add(key);
          return {
            ...options,
            hiddenTypes: Array.from(hiddenSet),
          };
        },
        'view.setTypeVisibility'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus?.emit?.('view:type-visibility-changed', { typeName: key, visible: shouldShow });
      }
    },
  };
}
