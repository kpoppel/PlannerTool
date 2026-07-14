/**
 * Coordinates capacity calculation inputs without owning UI events or State.
 *
 * CapacityCalculator remains the numeric implementation. This class owns the
 * legacy graph-filter policy and the empty-selection decision, making both
 * directly testable and reusable by the future application command layer.
 */
export class CapacityCoordinator {
  constructor(calculator) {
    if (!calculator || typeof calculator.calculate !== 'function') {
      throw new TypeError('CapacityCoordinator requires a CapacityCalculator');
    }
    this._calculator = calculator;
  }

  /**
   * @param {{
   *   features?: Array<object>, baselineTeams?: Array<object>, baselineProjects?: Array<object>,
   *   selectedProjectIds?: string[], allProjectIds?: string[], selectedTeamIds?: string[],
   *   selectedStateIds?: string[], graphOnlySelected?: boolean,
   *   requireProjectSelection?: boolean, requireTeamSelection?: boolean, stateFilterActive?: boolean,
   *   childrenByParent?: Map<string, string[]>, changedFeatureIds?: string[]|null,
   * }} input
   * @returns {{ result: object, calculated: boolean }}
   */
  calculate({
    features = [],
    baselineTeams = [],
    baselineProjects = [],
    selectedProjectIds = [],
    allProjectIds = [],
    selectedTeamIds = [],
    selectedStateIds = [],
    graphOnlySelected = false,
    requireProjectSelection = false,
    requireTeamSelection = false,
    stateFilterActive = true,
    childrenByParent = new Map(),
    changedFeatureIds = null,
  } = {}) {
    const projectsForFilter = graphOnlySelected ? selectedProjectIds : allProjectIds;
    const noSelectedProjects =
      graphOnlySelected && requireProjectSelection && selectedProjectIds.length === 0;
    const noSelectedTeams = requireTeamSelection && selectedTeamIds.length === 0;

    if (noSelectedProjects || noSelectedTeams || (stateFilterActive && selectedStateIds.length === 0)) {
      return { result: this._calculator._emptyResult(), calculated: false };
    }

    this._calculator.setChildrenByParent(childrenByParent);
    return {
      result: this._calculator.calculate(
        features,
        {
          selectedProjects: projectsForFilter,
          selectedTeams: selectedTeamIds,
          selectedStates: selectedStateIds,
        },
        baselineTeams,
        baselineProjects,
        changedFeatureIds
      ),
      calculated: true,
    };
  }
}
