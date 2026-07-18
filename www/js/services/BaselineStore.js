/**
 * BaselineStore Service
 * Stores immutable baseline data (projects, teams, features)
 */

export class BaselineStore {
  constructor() {
    this._projects = [];
    this._teams = [];
    this._features = [];
    this._originalOrder = [];
    this._featureById = new Map();
  }

  /**
   * Load all baseline data
   * @param {Object} data - { projects, teams, features }
   */
  loadBaseline(data) {
    this._projects = data.projects ? [...data.projects] : [];
    this._teams = data.teams ? [...data.teams] : [];
    this._features = data.features ? [...data.features] : [];

    // Store original feature order
    this._originalOrder = this._features.map((f) => f.id);
    this._rebuildFeatureIndex();
  }

  /**
   * Set projects
   * @param {Array} projects
   */
  setProjects(projects) {
    this._projects = [...projects];
  }

  /**
   * Get projects (immutable copy)
   * @returns {Array}
   */
  getProjects() {
    return JSON.parse(JSON.stringify(this._projects));
  }

  /**
   * Get projects reference for hot paths (do not mutate).
   * @returns {Array}
   */
  getProjectsRef() {
    return this._projects;
  }

  /**
   * Set teams
   * @param {Array} teams
   */
  setTeams(teams) {
    this._teams = [...teams];
  }

  /**
   * Get teams (immutable copy)
   * @returns {Array}
   */
  getTeams() {
    return JSON.parse(JSON.stringify(this._teams));
  }

  /**
   * Get teams reference for hot paths (do not mutate).
   * @returns {Array}
   */
  getTeamsRef() {
    return this._teams;
  }

  /**
   * Set features
   * @param {Array} features
   */
  setFeatures(features) {
    this._features = [...features];
    this._originalOrder = features.map((f) => f.id);
    this._rebuildFeatureIndex();
  }

  /**
   * Get features (immutable copy)
   * @returns {Array}
   */
  getFeatures() {
    return JSON.parse(JSON.stringify(this._features));
  }

  /**
   * Get features reference for hot paths (do not mutate).
   * @returns {Array}
   */
  getFeaturesRef() {
    return this._features;
  }

  /**
   * Get feature by ID map for fast lookups
   * @returns {Map<string, Object>}
   */
  getFeatureById() {
    return this._featureById;
  }

  /**
   * Get original feature order
   * @returns {Array<string>} Feature IDs in original order
   */
  getOriginalOrder() {
    return [...this._originalOrder];
  }

  /**
   * Clear all baseline data
   */
  clear() {
    this._projects = [];
    this._teams = [];
    this._features = [];
    this._originalOrder = [];
    this._featureById = new Map();
  }

  _rebuildFeatureIndex() {
    this._featureById = new Map(this._features.map((f) => [f.id, f]));
  }
}
