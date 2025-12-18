// dataService.js
// Centralized data access facade with pluggable BackendProvider.
// Default provider is an in-memory MockBackendProvider.

// Simulate async to match future fetch-based API
function delay(ms){ return new Promise(res => setTimeout(res, ms)); }

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
    async init(){
        if (this.providers['rest'] && typeof this.providers['rest'].init === 'function') {
            await this.providers['rest'].init();
        }
    }
    // Service health and capabilities
    async checkHealth() { return this.providers['rest'].checkHealth(); }
    async getCapabilities() { return this.providers['mock'].getCapabilities(); }
    // Configuration and local preferences
    async getConfig() { return this.providers['mock'].getConfig(); }
    async saveConfig(account) { return this.providers['rest'].saveConfig(account); }
    async getLocalPref(key) { return this.providers['local'].getLocalPref(key); }
    async setLocalPref(key, value) { return this.providers['local'].setLocalPref(key, value); }
    // --- Color Preferences Management ---
    async getColorMappings() { return this.providers['local'].loadColors(); }
    async clearColorMappings() { return this.providers['local'].clearAll(); }
    async updateProjectColor(id, color) { return this.providers['local'].saveProjectColor(id, color); }
    async updateTeamColor(id, color) { return this.providers['local'].saveTeamColor(id, color); }
    // --- Feature Data Management ---
    async getProjects() { return this.providers['rest'].getProjects(); }
    async getTeams() { return this.providers['rest'].getTeams(); }
    async getFeatures() { return this.providers['rest'].getFeatures(); }
    async setFeatureDates(id, start, end) { return this.providers['mock'].setFeatureDates(id, start, end); }
    async setFeatureField(id, field, value) { return this.providers['mock'].setFeatureField(id, field, value); }
    async batchSetFeatureDates(updates) { return this.providers['mock'].batchSetFeatureDates(updates); }
    // --- Scenario Management ---
    async publishBaseline(selectedOverrides) { return this.providers['rest'].publishBaseline(selectedOverrides); }
    async listScenarios() { return this.providers['rest'].listScenarios(); }
    async getScenario(id) { return this.providers['rest'].getScenario(id); }
    async deleteScenario(id) { return this.providers['rest'].deleteScenario(id); }
    async renameScenario(id, name) { return this.providers['rest'].renameScenario(id, name); }
    async saveScenario(scenario) { return this.providers['rest'].saveScenario(scenario); }
}

const providerMock = new ProviderMock();
const providerLocalStorage = new ProviderLocalStorage();
const providerREST = new ProviderREST();
export const dataService = new DataService({'mock' : providerMock, 'rest': providerREST, 'local': providerLocalStorage});
// Initialization now awaited by app.js before any API calls
