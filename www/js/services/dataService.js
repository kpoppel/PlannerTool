// dataService.js
// Centralized data access facade with pluggable BackendProvider.
// Default provider is an in-memory MockBackendProvider.

// ---------------- Provider Interface & Selection -----------------
/**
 * BackendProvider typedef (JSDoc)
 * @typedef {Object} BackendProvider
 * @property {function():Promise<void>} [init]
 * @property {function():Promise<Object>} fetchConfig
 * @property {function(string):Promise<{token:string}>} submitPat
 * @property {function():Promise<Object>} loadAll
 * @property {function():Promise<Array>} loadProjects
 * @property {function():Promise<Array>} loadTeams
 * @property {function():Promise<Array>} loadFeatures
 * @property {function(string,string,string):Promise<Object>} updateFeatureDates
 * @property {function(string,string,any):Promise<Object>} updateFeatureField
 * @property {function(Array<{id:string,start:string,end:string}>):Promise<Array<Object>>} batchUpdateFeatureDates
 * @property {function(Array<{id:string,start?:string,end?:string,capacity?:Array}>):Promise<Object>} updateTasksWithCapacity
 * @property {function(Object):Promise<Object>} saveScenario
 * @property {function(string, Array<string>=):Promise<Object>} annotateScenario
 * @property {function(string):Promise<boolean>} deleteScenario
 * @property {function(string,string):Promise<Object>} renameScenario
 * @property {function():Promise<Array>} listScenarios
 * @property {function():Promise<{projectColors:Object, teamColors:Object}>} getColorMappings
 * @property {function(string,string):Promise<void>} updateProjectColor
 * @property {function(string,string):Promise<void>} updateTeamColor
 * @property {function():Promise<Object>} capabilities
 * @property {function():Promise<{ok:boolean}>} health
 */

import { ProviderMock } from './providerMock.js';
import { ProviderLocalStorage } from './providerLocalStorage.js';
import { ProviderREST } from './providerREST.js';

class DataService {
  constructor(providers) {
    this.providers = providers;
  }

  // Boundary policy:
  // - Public dataService methods keep legacy unwrapped return contracts for compatibility.
  // - `callRestResult` exposes raw Result envelopes for migration/callers that need error details.
  async callRestResult(methodName, ...args) {
    const fn = this.providers['rest'][methodName];
    if (typeof fn !== 'function') {
      return { ok: false, error: { message: `Unknown REST method: ${methodName}` } };
    }
    return fn.apply(this.providers['rest'], args);
  }

  _unwrapOrFallback(methodName, result, fallback) {
    if (result && result.ok === true) {
      return result.data;
    }

    const message = result && result.error && result.error.message
      ? result.error.message
      : 'request_failed';
    console.warn(`[dataService] ${methodName} using fallback after provider failure`, {
      error: result && result.error ? result.error : { message },
    });
    return fallback;
  }

  async init() {
    if (this.providers['rest'] && typeof this.providers['rest'].init === 'function') {
      await this.providers['rest'].init();
    }
  }
  // Service health and capabilities
  async checkHealth() {
    const result = await this.providers['rest'].checkHealth();
    return this._unwrapOrFallback('checkHealth', result, { status: 'error' });
  }
  async getCapabilities() {
    return this.providers['mock'].getCapabilities();
  }
  // Configuration and local preferences
  async getConfig() {
    return this.providers['mock'].getConfig();
  }
  async saveConfig(account) {
    return this.providers['rest'].saveConfig(account);
  }
  async getLocalPref(key) {
    return this.providers['local'].getLocalPref(key);
  }
  async setLocalPref(key, value) {
    return this.providers['local'].setLocalPref(key, value);
  }
  // --- Color Preferences Management ---
  async getColorMappings() {
    return this.providers['local'].loadColors();
  }
  async clearColorMappings() {
    return this.providers['local'].clearAll();
  }
  async updateProjectColor(id, color) {
    return this.providers['local'].saveProjectColor(id, color);
  }
  async updateTeamColor(id, color) {
    return this.providers['local'].saveTeamColor(id, color);
  }
  // --- Feature Data Management ---
  async getProjects() {
    const result = await this.providers['rest'].getProjects();
    return this._unwrapOrFallback('getProjects', result, []);
  }
  async getIterationsConfig() {
    const result = await this.providers['rest'].getIterationsConfig();
    return this._unwrapOrFallback('getIterationsConfig', result, { iterationSetsById: {} });
  }

  async getIterationSets() {
    const result = await this.providers['rest'].getIterationSets();
    return this._unwrapOrFallback('getIterationSets', result, {});
  }
  async getTeams() {
    const result = await this.providers['rest'].getTeams();
    return this._unwrapOrFallback('getTeams', result, []);
  }
  /**
   * Fetch history entries for a project.
   * @param {string} projectId
   * @param {{per_page?:number, invalidate_cache?:boolean}} [opts]
   */
  async getHistory(projectId, opts) {
    const result = await this.providers['rest'].getHistory(projectId, opts);
    return this._unwrapOrFallback('getHistory', result, { tasks: [] });
  }
  async getCostTeams() {
    if (!this.providers['rest'].getCostTeams) return [];
    const result = await this.providers['rest'].getCostTeams();
    return this._unwrapOrFallback('getCostTeams', result, []);
  }
  async getFeatures() {
    const result = await this.providers['rest'].getFeatures();
    return this._unwrapOrFallback('getFeatures', result, []);
  }
  async getCost(overrides) {
    const result = await this.providers['rest'].getCost(overrides);
    return this._unwrapOrFallback('getCost', result, { projects: [], months: [], teams: [] });
  }
  async getMarkers() {
    const result = await this.providers['rest'].getMarkers();
    return this._unwrapOrFallback('getMarkers', result, []);
  }
  async getPluginsConfig() {
    const result = await this.providers['rest'].getPluginsConfig();
    return this._unwrapOrFallback('getPluginsConfig', result, { schema_version: 1, plugins: [] });
  }

  async getPluginsSchemas() {
    const result = await this.providers['rest'].getPluginsSchemas();
    return this._unwrapOrFallback('getPluginsSchemas', result, {});
  }
  /** @param {string} [planId] */
  async getEvents(planId) {
    const result = await this.providers['rest'].getEvents(planId);
    return this._unwrapOrFallback('getEvents', result, []);
  }
  /** @param {{date:string, title:string, plan_id:string}} data */
  async createEvent(data) {
    const result = await this.providers['rest'].createEvent(data);
    return this._unwrapOrFallback('createEvent', result, null);
  }
  /**
   * @param {string} eventId
   * @param {{date?:string, title?:string, plan_id?:string}} data
   */
  async updateEvent(eventId, data) {
    const result = await this.providers['rest'].updateEvent(eventId, data);
    return this._unwrapOrFallback('updateEvent', result, null);
  }
  /** @param {string} eventId */
  async deleteEvent(eventId) {
    const result = await this.providers['rest'].deleteEvent(eventId);
    return this._unwrapOrFallback('deleteEvent', result, false);
  }
  async getEventCategories() {
    const result = await this.providers['rest'].getEventCategories();
    return this._unwrapOrFallback('getEventCategories', result, []);
  }
  /** @param {{name: string, is_special?: boolean}} data */
  async createEventCategory(data) {
    const result = await this.providers['rest'].createEventCategory(data);
    return this._unwrapOrFallback('createEventCategory', result, null);
  }
  /**
   * @param {string} categoryId
   * @param {{name?: string, is_special?: boolean}} data
   */
  async updateEventCategory(categoryId, data) {
    const result = await this.providers['rest'].updateEventCategory(categoryId, data);
    return this._unwrapOrFallback('updateEventCategory', result, null);
  }
  /** @param {string} categoryId */
  async deleteEventCategory(categoryId) {
    const result = await this.providers['rest'].deleteEventCategory(categoryId);
    return this._unwrapOrFallback('deleteEventCategory', result, false);
  }
  async invalidateCache() {
    const result = await this.providers['rest'].invalidateCache();
    return this._unwrapOrFallback('invalidateCache', result, { ok: false, error: { message: 'request_failed' } });
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
    const result = await this.providers['rest'].updateTasksWithCapacity(updates);
    return this._unwrapOrFallback('updateTasksWithCapacity', result, { ok: false, error: { message: 'request_failed' } });
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
    const result = await this.providers['rest'].updateWorkItemCapacity(workItemId, capacity);
    return this._unwrapOrFallback('updateWorkItemCapacity', result, { ok: false, error: { message: 'request_failed' } });
  }
  // --- Scenario Management ---
  async publishBaseline(selectedOverrides) {
    const result = await this.providers['rest'].publishBaseline(selectedOverrides);
    return this._unwrapOrFallback('publishBaseline', result, { ok: false, error: { message: 'request_failed' } });
  }
  async listScenarios() {
    const result = await this.providers['rest'].listScenarios();
    return this._unwrapOrFallback('listScenarios', result, []);
  }
  async getScenario(id) {
    const result = await this.providers['rest'].getScenario(id);
    return this._unwrapOrFallback('getScenario', result, null);
  }
  async loadAllScenarios() {
    const result = await this.providers['rest'].loadAllScenarios();
    return this._unwrapOrFallback('loadAllScenarios', result, []);
  }
  async deleteScenario(id) {
    const result = await this.providers['rest'].deleteScenario(id);
    return this._unwrapOrFallback('deleteScenario', result, false);
  }
  async renameScenario(id, name) {
    const result = await this.providers['rest'].renameScenario(id, name);
    return this._unwrapOrFallback('renameScenario', result, null);
  }
  async saveScenario(scenario) {
    const result = await this.providers['rest'].saveScenario(scenario);
    return this._unwrapOrFallback('saveScenario', result, { ok: false, error: { message: 'request_failed' } });
  }
  // --- View Management ---
  async listViews() {
    const result = await this.providers['rest'].listViews();
    return this._unwrapOrFallback('listViews', result, []);
  }
  async getView(id) {
    const result = await this.providers['rest'].getView(id);
    return this._unwrapOrFallback('getView', result, null);
  }
  async saveView(view) {
    const result = await this.providers['rest'].saveView(view);
    return this._unwrapOrFallback('saveView', result, { ok: false, error: { message: 'request_failed' } });
  }
  async renameView(id, name) {
    const result = await this.providers['rest'].renameView(id, name);
    return this._unwrapOrFallback('renameView', result, { ok: false, error: { message: 'request_failed' } });
  }
  async deleteView(id) {
    const result = await this.providers['rest'].deleteView(id);
    return this._unwrapOrFallback('deleteView', result, false);
  }

  // --- Group Management ---
  /** @param {string} [planId] */
  async listGroups(planId) {
    const result = await this.providers['rest'].listGroups(planId);
    return this._unwrapOrFallback('listGroups', result, []);
  }
  /** @param {{ plan_id:string, name:string, color?:string, rank?:number }} payload */
  async createGroup(payload) {
    const result = await this.providers['rest'].createGroup(payload);
    return this._unwrapOrFallback('createGroup', result, null);
  }
  /** @param {string} groupId @param {{ name?:string, color?:string }} fields */
  async updateGroup(groupId, fields) {
    const result = await this.providers['rest'].updateGroup(groupId, fields);
    return this._unwrapOrFallback('updateGroup', result, null);
  }
  /** @param {string} groupId */
  async deleteGroup(groupId) {
    const result = await this.providers['rest'].deleteGroup(groupId);
    return this._unwrapOrFallback('deleteGroup', result, false);
  }
}

const providerMock = new ProviderMock();
const providerLocalStorage = new ProviderLocalStorage();
const providerREST = new ProviderREST();
export const dataService = new DataService({
  mock: providerMock,
  rest: providerREST,
  local: providerLocalStorage,
});
