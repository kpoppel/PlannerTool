// dataService.js
// Centralized data access facade backed by REST plus injected preferences storage.

import { ProviderREST } from './providerREST.js';
import { PreferencesStorage } from './preferencesStorage.js';
import { asResult, fail } from './result.js';

class DataService {
  constructor({ rest, storage }) {
    this.rest = rest;
    this.storage = storage;
  }

  async _invoke(run, opts = {}) {
    const { message = 'Request failed' } = opts;
    try {
      const value = await run();
      return asResult(value, { ...opts, message });
    } catch (error) {
      return fail(error, message);
    }
  }

  async init() {
    if (this.rest && typeof this.rest.init === 'function') {
      await this.rest.init();
    }
    return asResult(true);
  }

  // Service health
  async checkHealth() {
    return this._invoke(() => this.rest.checkHealth(), {
      message: 'Failed to check server health',
    });
  }

  // Configuration and local preferences
  async getConfig() {
    return this._invoke(() => this.rest.getConfig(), {
      message: 'Failed to load config',
    });
  }

  async saveConfig(account) {
    return this._invoke(() => this.rest.saveConfig(account), {
      message: 'Failed to save config',
    });
  }

  async getLocalPref(key) {
    return this._invoke(() => this.storage.getLocalPref(key), {
      message: `Failed to read local preference: ${key}`,
    });
  }

  async setLocalPref(key, value) {
    return this._invoke(() => this.storage.setLocalPref(key, value), {
      message: `Failed to write local preference: ${key}`,
    });
  }

  // --- Color Preferences Management ---
  async getColorMappings() {
    return this._invoke(() => this.storage.loadColors(), {
      message: 'Failed to load color mappings',
    });
  }

  async clearColorMappings() {
    return this._invoke(() => this.storage.clearAll(), {
      message: 'Failed to clear color mappings',
    });
  }

  async updateProjectColor(id, color) {
    return this._invoke(() => this.storage.saveProjectColor(id, color), {
      message: `Failed to update project color: ${id}`,
    });
  }

  async updateTeamColor(id, color) {
    return this._invoke(() => this.storage.saveTeamColor(id, color), {
      message: `Failed to update team color: ${id}`,
    });
  }

  // --- Feature Data Management ---
  async getProjects() {
    return this._invoke(() => this.rest.getProjects(), {
      message: 'Failed to load projects',
    });
  }

  async getIterations(project) {
    return this._invoke(() => this.rest.getIterations(project), {
      message: 'Failed to load iterations',
    });
  }

  async getTeams() {
    return this._invoke(() => this.rest.getTeams(), {
      message: 'Failed to load teams',
    });
  }

  /**
   * Fetch history entries for a project.
   * @param {string} projectId
   * @param {{per_page?:number, invalidate_cache?:boolean}} [opts]
   */
  async getHistory(projectId, opts) {
    return this._invoke(() => this.rest.getHistory(projectId, opts), {
      message: `Failed to load history for project: ${projectId}`,
    });
  }

  async getCostTeams() {
    return this._invoke(() => this.rest.getCostTeams(), {
      message: 'Failed to load cost teams',
    });
  }

  async getFeatures() {
    return this._invoke(() => this.rest.getFeatures(), {
      message: 'Failed to load features',
    });
  }

  async getCost(overrides) {
    return this._invoke(() => this.rest.getCost(overrides), {
      message: 'Failed to load cost data',
    });
  }

  async getMarkers() {
    return this._invoke(() => this.rest.getMarkers(), {
      message: 'Failed to load markers',
    });
  }

  async getPluginsConfig() {
    return this._invoke(() => this.rest.getPluginsConfig(), {
      message: 'Failed to load plugin config',
    });
  }

  async getPluginsSchemas() {
    return this._invoke(() => this.rest.getPluginsSchemas(), {
      message: 'Failed to load plugin schemas',
    });
  }

  /** @param {string} [planId] */
  async getEvents(planId) {
    return this._invoke(() => this.rest.getEvents(planId), {
      message: 'Failed to load events',
    });
  }

  /** @param {{date:string, title:string, plan_id:string}} data */
  async createEvent(data) {
    return this._invoke(() => this.rest.createEvent(data), {
      nullIsError: true,
      message: 'Failed to create event',
    });
  }

  /**
   * @param {string} eventId
   * @param {{date?:string, title?:string, plan_id?:string}} data
   */
  async updateEvent(eventId, data) {
    return this._invoke(() => this.rest.updateEvent(eventId, data), {
      nullIsError: true,
      message: `Failed to update event: ${eventId}`,
    });
  }

  /** @param {string} eventId */
  async deleteEvent(eventId) {
    return this._invoke(() => this.rest.deleteEvent(eventId), {
      falseIsError: true,
      message: `Failed to delete event: ${eventId}`,
    });
  }

  async getEventCategories() {
    return this._invoke(() => this.rest.getEventCategories(), {
      message: 'Failed to load event categories',
    });
  }

  /** @param {{name: string, is_special?: boolean}} data */
  async createEventCategory(data) {
    return this._invoke(() => this.rest.createEventCategory(data), {
      nullIsError: true,
      message: 'Failed to create event category',
    });
  }

  /**
   * @param {string} categoryId
   * @param {{name?: string, is_special?: boolean}} data
   */
  async updateEventCategory(categoryId, data) {
    return this._invoke(() => this.rest.updateEventCategory(categoryId, data), {
      nullIsError: true,
      message: `Failed to update event category: ${categoryId}`,
    });
  }

  /** @param {string} categoryId */
  async deleteEventCategory(categoryId) {
    return this._invoke(() => this.rest.deleteEventCategory(categoryId), {
      falseIsError: true,
      message: `Failed to delete event category: ${categoryId}`,
    });
  }

  async invalidateCache() {
    return this._invoke(() => this.rest.invalidateCache(), {
      message: 'Failed to invalidate cache',
    });
  }

  /**
   * Update tasks with optional dates and/or capacity data.
   * @param {Array<{id:string, start?:string, end?:string, capacity?:Array<{team:string, capacity:number}>}>} updates
   * @returns {Promise<{ok:boolean, updated:number, errors:Array<string>}>}
   * @example
   * await dataService.updateTasksWithCapacity([
   *   { id: '12345', start: '2026-01-01', end: '2026-01-31' },
   *   { id: '67890', capacity: [
   *     { team: 'team-frontend', capacity: 80 },
   *     { team: 'team-backend', capacity: 20 }
   *   ]},
   *   { id: '11111', start: '2026-02-01', capacity: [
   *     { team: 'team-architecture', capacity: 100 }
   *   ]}
   * ]);
   */
  async updateTasksWithCapacity(updates) {
    return this._invoke(() => this.rest.updateTasksWithCapacity(updates), {
      message: 'Failed to update tasks with capacity',
    });
  }

  /**
   * Update capacity for a specific work item.
   * @param {string} workItemId - The work item ID
   * @param {Array<{team:string, capacity:number}>} capacity - Array of team allocations
   * @returns {Promise<{ok:boolean, work_item_id:number, error?:string}>}
   * @example
   * await dataService.updateWorkItemCapacity('12345', [
   *   { team: 'team-frontend', capacity: 80 },
   *   { team: 'team-backend', capacity: 20 }
   * ]);
   */
  async updateWorkItemCapacity(workItemId, capacity) {
    return this._invoke(() => this.rest.updateWorkItemCapacity(workItemId, capacity), {
      message: `Failed to update work item capacity: ${workItemId}`,
    });
  }

  // --- Scenario Management ---
  async publishBaseline(selectedOverrides) {
    return this._invoke(() => this.rest.publishBaseline(selectedOverrides), {
      message: 'Failed to publish baseline',
    });
  }

  async listScenarios() {
    return this._invoke(() => this.rest.listScenarios(), {
      message: 'Failed to list scenarios',
    });
  }

  async getScenario(id) {
    return this._invoke(() => this.rest.getScenario(id), {
      nullIsError: true,
      message: `Failed to load scenario: ${id}`,
    });
  }

  async loadAllScenarios() {
    return this._invoke(() => this.rest.loadAllScenarios(), {
      message: 'Failed to load all scenarios',
    });
  }

  async deleteScenario(id) {
    return this._invoke(() => this.rest.deleteScenario(id), {
      falseIsError: true,
      message: `Failed to delete scenario: ${id}`,
    });
  }

  async renameScenario(id, name) {
    return this._invoke(() => this.rest.renameScenario(id, name), {
      message: `Failed to rename scenario: ${id}`,
    });
  }

  async saveScenario(scenario) {
    return this._invoke(() => this.rest.saveScenario(scenario), {
      message: `Failed to save scenario: ${scenario?.id || 'unknown'}`,
    });
  }

  // --- View Management ---
  async listViews() {
    return this._invoke(() => this.rest.listViews(), {
      message: 'Failed to list views',
    });
  }

  async getView(id) {
    return this._invoke(() => this.rest.getView(id), {
      nullIsError: true,
      message: `Failed to load view: ${id}`,
    });
  }

  async saveView(view) {
    return this._invoke(() => this.rest.saveView(view), {
      message: 'Failed to save view',
    });
  }

  async renameView(id, name) {
    return this._invoke(() => this.rest.renameView(id, name), {
      message: `Failed to rename view: ${id}`,
    });
  }

  async deleteView(id) {
    return this._invoke(() => this.rest.deleteView(id), {
      falseIsError: true,
      message: `Failed to delete view: ${id}`,
    });
  }

  // --- Group Management ---
  /** @param {string} [planId] */
  async listGroups(planId) {
    return this._invoke(() => this.rest.listGroups(planId), {
      message: 'Failed to list groups',
    });
  }

  /** @param {{ plan_id:string, name:string, color?:string, rank?:number }} payload */
  async createGroup(payload) {
    return this._invoke(() => this.rest.createGroup(payload), {
      nullIsError: true,
      message: 'Failed to create group',
    });
  }

  /** @param {string} groupId @param {{ name?:string, color?:string }} fields */
  async updateGroup(groupId, fields) {
    return this._invoke(() => this.rest.updateGroup(groupId, fields), {
      nullIsError: true,
      message: `Failed to update group: ${groupId}`,
    });
  }

  /** @param {string} groupId */
  async deleteGroup(groupId) {
    return this._invoke(() => this.rest.deleteGroup(groupId), {
      falseIsError: true,
      message: `Failed to delete group: ${groupId}`,
    });
  }
}

const providerREST = new ProviderREST();
const preferencesStorage = new PreferencesStorage(window.localStorage);
export const dataService = new DataService({
  rest: providerREST,
  storage: preferencesStorage,
});
