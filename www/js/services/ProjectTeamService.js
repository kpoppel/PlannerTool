import { ProjectEvents, TeamEvents } from '../core/EventRegistry.js';

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
  }

  /**
   * Initialize projects and teams from baseline data
   * @param {Array} baselineProjects - Array of baseline project objects
   * @param {Array} baselineTeams - Array of baseline team objects
   */
  initFromBaseline(baselineProjects, baselineTeams) {
    // Create working copies (do not mutate baseline)
    this.projects = baselineProjects.map(p => ({ ...p }));
    this.teams = baselineTeams.map(t => ({ ...t }));
  }

  /**
   * Refresh projects and teams from new baseline data
   * Preserves existing selection state
   * @param {Array} baselineProjects - New baseline projects
   * @param {Array} baselineTeams - New baseline teams
   */
  refreshFromBaseline(baselineProjects, baselineTeams) {
    // Preserve selection state
    const selectedProjects = new Set(this.projects.filter(p => p.selected).map(p => p.id));
    const selectedTeams = new Set(this.teams.filter(t => t.selected).map(t => t.id));
    
    // Create new working copies with preserved selection
    this.projects = baselineProjects.map(p => ({
      ...p,
      selected: selectedProjects.has(p.id)
    }));
    this.teams = baselineTeams.map(t => ({
      ...t,
      selected: selectedTeams.has(t.id)
    }));
  }

  /**
   * Set project selection state
   * @param {string} id - Project ID
   * @param {boolean} selected - Selection state
   * @returns {boolean} - True if project was found and updated
   */
  setProjectSelected(id, selected) {
    const p = this.projects.find(x => x.id === id);
    if (!p) return false;
    p.selected = selected;
    this._bus.emit(ProjectEvents.CHANGED, this.projects);
    return true;
  }

  /**
   * Set team selection state
   * @param {string} id - Team ID
   * @param {boolean} selected - Selection state
   * @returns {boolean} - True if team was found and updated
   */
  setTeamSelected(id, selected) {
    const t = this.teams.find(x => x.id === id);
    if (!t) return false;
    t.selected = selected;
    this._bus.emit(TeamEvents.CHANGED, this.teams);
    return true;
  }

  /**
   * Get selected project IDs
   * @returns {Array<string>} - Array of selected project IDs
   */
  getSelectedProjectIds() {
    return this.projects.filter(p => p.selected).map(p => p.id);
  }

  /**
   * Get selected team IDs
   * @returns {Array<string>} - Array of selected team IDs
   */
  getSelectedTeamIds() {
    return this.teams.filter(t => t.selected).map(t => t.id);
  }

  /**
   * Get projects array
   * @returns {Array} - Working copy of projects
   */
  getProjects() {
    return this.projects;
  }

  /**
   * Get teams array
   * @returns {Array} - Working copy of teams
   */
  getTeams() {
    return this.teams;
  }

  /**
   * Capture current filter state (selected projects and teams)
   * @returns {Object} - Filter state with projects and teams arrays
   */
  captureCurrentFilters() {
    return {
      projects: this.getSelectedProjectIds(),
      teams: this.getSelectedTeamIds()
    };
  }

  /**
   * Compute organization load for a feature based on selected teams
   * Returns a percentage string like '45.0%'
   * @param {Object} feature - Feature object with capacity array
   * @returns {string} - Organization load percentage
   */
  computeFeatureOrgLoad(feature) {
    const numTeamsGlobal = this.teams.length === 0 ? 1 : this.teams.length;
    let sum = 0;
    for (const tl of feature.capacity || []) {
      const t = this.teams.find(x => x.id === tl.team && x.selected);
      if (!t) continue;
      sum += tl.capacity;
    }
    return (sum / numTeamsGlobal).toFixed(1) + '%';
  }
}
