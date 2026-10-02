// dataService.js
// REST methods preserve Result envelopes; browser preferences remain local values.

import { ProviderMock } from './providerMock.js';
import { ProviderLocalStorage } from './providerLocalStorage.js';
import { ProviderREST } from './providerREST.js';

class DataService {
  constructor(providers) {
    this.providers = providers;
  }

  async init() {
    if (this.providers['rest'] && typeof this.providers['rest'].init === 'function') {
      await this.providers['rest'].init();
    }
  }
  // Service health and capabilities
  async checkHealth() {
    return this.providers['rest'].checkHealth();
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
  async signOut() {
    await this.providers['rest'].signOut();
    await this.providers['local'].clearBrowserData();
  }
  async deleteAccount(email, accountKey) {
    await this.providers['rest'].deleteAccount(email, accountKey);
    await this.providers['local'].clearBrowserData();
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
    return this.providers['rest'].getProjects();
  }
  async getIterationsConfig() {
    return this.providers['rest'].getIterationsConfig();
  }

  async getIterationSets() {
    return this.providers['rest'].getIterationSets();
  }
  async getTeams() {
    return this.providers['rest'].getTeams();
  }
  /**
   * Fetch history entries for a project.
   * @param {string} projectId
   * @param {{per_page?:number, invalidate_cache?:boolean}} [opts]
   */
  async getHistory(projectId, opts) {
    return this.providers['rest'].getHistory(projectId, opts);
  }
  async getCostTeams() {
    return this.providers['rest'].getCostTeams();
  }
  async getFeatures() {
    return this.providers['rest'].getFeatures();
  }
  async getCost(overrides) {
    return this.providers['rest'].getCost(overrides);
  }
  async getMarkers() {
    return this.providers['rest'].getMarkers();
  }
  async getPluginsConfig() {
    return this.providers['rest'].getPluginsConfig();
  }

  async getPluginsSchemas() {
    return this.providers['rest'].getPluginsSchemas();
  }
  /** @param {string} [planId] */
  async getEvents(planId) {
    return this.providers['rest'].getEvents(planId);
  }
  /** @param {{date:string, title:string, plan_id:string}} data */
  async createEvent(data) {
    return this.providers['rest'].createEvent(data);
  }
  /**
   * @param {string} eventId
   * @param {{date?:string, title?:string, plan_id?:string}} data
   */
  async updateEvent(eventId, data) {
    return this.providers['rest'].updateEvent(eventId, data);
  }
  /** @param {string} eventId */
  async deleteEvent(eventId) {
    return this.providers['rest'].deleteEvent(eventId);
  }
  async getEventCategories() {
    return this.providers['rest'].getEventCategories();
  }
  /** @param {{name: string, is_special?: boolean}} data */
  async createEventCategory(data) {
    return this.providers['rest'].createEventCategory(data);
  }
  /**
   * @param {string} categoryId
   * @param {{name?: string, is_special?: boolean}} data
   */
  async updateEventCategory(categoryId, data) {
    return this.providers['rest'].updateEventCategory(categoryId, data);
  }
  /** @param {string} categoryId */
  async deleteEventCategory(categoryId) {
    return this.providers['rest'].deleteEventCategory(categoryId);
  }
  async invalidateCache() {
    return this.providers['rest'].invalidateCache();
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
    return this.providers['rest'].updateTasksWithCapacity(updates);
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
    return this.providers['rest'].updateWorkItemCapacity(workItemId, capacity);
  }
  // --- Scenario Management ---
  async publishBaseline(selectedOverrides) {
    const result = await this.providers['rest'].publishBaseline(selectedOverrides);
    return result;
  }
  async listScenarios() {
    return this.providers['rest'].listScenarios();
  }
  async getScenario(id) {
    return this.providers['rest'].getScenario(id);
  }
  async loadAllScenarios() {
    return this.providers['rest'].loadAllScenarios();
  }
  async deleteScenario(id) {
    return this.providers['rest'].deleteScenario(id);
  }
  async saveScenario(scenario) {
    const payload = {
      id: scenario.id,
      name: scenario.name,
      overrides: scenario.overrides,
      filters: scenario.filters,
      view: scenario.view,
      scenarioGroups: scenario.scenarioGroups,
      groupOverrides: scenario.groupOverrides,
      pluginData: scenario.pluginData,
    };

    return this.providers['rest'].saveScenario(payload);
  }
  // --- View Management ---
  async listViews() {
    return this.providers['rest'].listViews();
  }
  async getView(id) {
    return this.providers['rest'].getView(id);
  }
  async saveView(view) {
    return this.providers['rest'].saveView(view);
  }
  async renameView(id, name) {
    return this.providers['rest'].renameView(id, name);
  }
  async deleteView(id) {
    return this.providers['rest'].deleteView(id);
  }

  // --- Group Management ---
  /** @param {string} [planId] */
  async listGroups(planId) {
    return this.providers['rest'].listGroups(planId);
  }
  /** @param {{ plan_id:string, name:string, color?:string, rank?:number }} payload */
  async createGroup(payload) {
    const result = await this.providers['rest'].createGroup(payload);
    return result;
  }
  /** @param {string} groupId @param {{ name?:string, color?:string }} fields */
  async updateGroup(groupId, fields) {
    const result = await this.providers['rest'].updateGroup(groupId, fields);
    return result;
  }
  /** @param {string} groupId */
  async deleteGroup(groupId) {
    const result = await this.providers['rest'].deleteGroup(groupId);
    return result;
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
