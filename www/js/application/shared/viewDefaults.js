/**
 * Canonical default values for the `view.options` store branch.
 *
 * These are the values the Default View restores to, and the values the store
 * starts with so selectors can read `view.options` before any view is applied.
 */

/**
 * @returns {Object} A fresh, mutable copy of the default view options.
 */
export function createDefaultViewOptions() {
  return {
    timelineScale: 'months',
    condensedCards: false,
    featureSortMode: 'rank',
    capacityViewMode: 'team',
    displayMode: 'normal',
    packedMode: false,
    showUnassignedCards: true,
    showUnplannedWork: true,
    showOnlyProjectHierarchy: false,
    highlightFeatureRelationMode: true,
    hiddenTypes: [],
    expandParentChild: false,
    expandRelations: false,
    expandTeamAllocated: false,
    debugFlag: false,
  };
}
