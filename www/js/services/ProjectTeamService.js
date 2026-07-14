/**
 * ProjectTeamService
 *
 * Manages working copies of projects and teams, including selection state
 * and color assignments. Provides methods to manipulate selection state
 * and emits events when projects or teams change.
 */
export class ProjectTeamService {
  constructor(bus) {
    this._bus = bus;
    this.projects = [];
    this.teams = [];
    this._selection = null;
  }

  setSelectionProvider(selection) {
    this._selection = selection;
  }

  /**
   * Initialize projects and teams from baseline data
   * @param {Array} baselineProjects - Array of baseline project objects
   * @param {Array} baselineTeams - Array of baseline team objects
   */
  initFromBaseline(baselineProjects, baselineTeams) {
    // Create working copies (do not mutate baseline)
    this.projects = baselineProjects.map((p) => ({ ...p }));
    this.teams = baselineTeams.map((t) => ({ ...t }));
  }

  /**
   * Refresh projects and teams from new baseline data
   * Preserves existing selection state
   * @param {Array} baselineProjects - New baseline projects
   * @param {Array} baselineTeams - New baseline teams
   */
  refreshFromBaseline(baselineProjects, baselineTeams) {
    // Preserve selection state
    const selectedProjects = new Set(
      this.projects.filter((p) => p.selected).map((p) => p.id)
    );
    const selectedTeams = new Set(this.teams.filter((t) => t.selected).map((t) => t.id));

    // Create new working copies with preserved selection
    this.projects = baselineProjects.map((p) => ({
      ...p,
      selected: selectedProjects.has(p.id),
    }));
    this.teams = baselineTeams.map((t) => ({
      ...t,
      selected: selectedTeams.has(t.id),
    }));
  }

  /**
   * Set project selection state
   * @param {string} id - Project ID
   * @param {boolean} selected - Selection state
   * @returns {boolean} - True if project was found and updated
   */
  setProjectSelected(id, selected) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return false;
    p.selected = selected;
    return true;
  }

  /**
   * Set team selection state
   * @param {string} id - Team ID
   * @param {boolean} selected - Selection state
   * @returns {boolean} - True if team was found and updated
   */
  setTeamSelected(id, selected) {
    const t = this.teams.find((x) => x.id === id);
    if (!t) return false;
    t.selected = selected;
    return true;
  }

  /**
   * Set multiple project selections in bulk without emitting per-item events.
   * @param {Object} selections - Mapping of projectId -> boolean
   * @returns {number} Number of projects actually changed
   */
  setProjectsSelectedBulk(selections) {
    if (!selections || typeof selections !== 'object') return 0;
    let changed = 0;
    for (const [id, selected] of Object.entries(selections)) {
      const p = this.projects.find((x) => x.id === id);
      if (!p) continue;
      if (p.selected !== !!selected) {
        p.selected = !!selected;
        changed++;
      }
    }
    // Caller is responsible for emitting events after bulk update
    return changed;
  }

  /**
   * Set multiple team selections in bulk without emitting per-item events.
   * @param {Object} selections - Mapping of teamId -> boolean
   * @returns {number} Number of teams actually changed
   */
  setTeamsSelectedBulk(selections) {
    if (!selections || typeof selections !== 'object') return 0;
    let changed = 0;
    for (const [id, selected] of Object.entries(selections)) {
      const t = this.teams.find((x) => x.id === id);
      if (!t) continue;
      if (t.selected !== !!selected) {
        t.selected = !!selected;
        changed++;
      }
    }
    // Caller is responsible for emitting events after bulk update
    return changed;
  }

  /**
   * Get selected project IDs
   * @returns {Array<string>} - Array of selected project IDs
   */
  getSelectedProjectIds() {
    return this.projects.filter((p) => p.selected).map((p) => p.id);
  }

  /**
   * Get selected team IDs
   * @returns {Array<string>} - Array of selected team IDs
   */
  getSelectedTeamIds() {
    return this.teams.filter((t) => t.selected).map((t) => t.id);
  }

  /**
   * Get projects array
   * @returns {Array} - Working copy of projects
   */
  getProjects() {
    if (!this._selection) return this.projects;
    const selectedIds = new Set(this._selection.getProjectIds());
    return this.projects.map((project) => ({
      ...project,
      selected: selectedIds.has(project.id),
    }));
  }

  /**
   * Get teams array
   * @returns {Array} - Working copy of teams
   */
  getTeams() {
    if (!this._selection) return this.teams;
    const selectedIds = new Set(this._selection.getTeamIds());
    return this.teams.map((team) => ({
      ...team,
      selected: selectedIds.has(team.id),
    }));
  }

  /**
   * Capture current filter state (selected projects and teams)
   * @returns {Object} - Filter state with projects and teams arrays
   */
  captureCurrentFilters() {
    return {
      projects: this.getProjects()
        .filter((project) => project.selected)
        .map((project) => project.id),
      teams: this.getTeams()
        .filter((team) => team.selected)
        .map((team) => team.id),
    };
  }

  /**
   * Compute organization load for a feature based on selected teams
   * Returns a percentage string like '45.0%'
   * A deselected team counts towards neither the numerator nor the
   * denominator: deselecting a team excludes both its own capacity and its
   * "seat" in the team-count average, consistent with CapacityCalculator.
   * @param {Object} feature - Feature object with capacity array
   * @returns {string} - Organization load percentage
   */
  computeFeatureOrgLoad(feature) {
    const teams = this.getTeams();
    const selectedTeamCount = teams.filter((team) => team.selected).length;
    const numTeamsGlobal = selectedTeamCount === 0 ? 1 : selectedTeamCount;
    let sum = 0;
    for (const tl of feature.capacity || []) {
      const t = teams.find((team) => team.id === tl.team && team.selected);
      if (!t) continue;
      sum += tl.capacity;
    }
    return (sum / numTeamsGlobal).toFixed(1) + '%';
  }
}
