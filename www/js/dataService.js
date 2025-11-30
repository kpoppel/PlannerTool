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
 * @property {function():Promise<{features:Array, diff?:Object}>} refreshBaseline
 * @property {function(Object):Promise<Object>} saveScenario
 * @property {function(string, Array<string>=):Promise<Object>} annotateScenario
 * @property {function(string, Array<{id:string,start:string,end:string}>):Promise<Object>} persistScenarioOverrides
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
    async getConfig() { return this.providers['mock'].getConfig(); }
    async getCapabilities() { return this.providers['mock'].getCapabilities(); }
    async checkHealth() { return this.providers['mock'].checkHealth(); }
    async setPat(patInput) { return this.providers['mock'].setPat(patInput); }

    async getAll() { return this.providers['mock'].getAll(); }
    async getProjects() { return this.providers['mock'].getProjects(); }
    async getTeams() { return this.providers['mock'].getTeams(); }
    async getFeatures() { return this.providers['mock'].getFeatures(); }
    async setFeatureDates(id, start, end) { return this.providers['mock'].setFeatureDates(id, start, end); }
    async setFeatureField(id, field, value) { return this.providers['mock'].setFeatureField(id, field, value); }
    async batchSetFeatureDates(updates) { return this.providers['mock'].batchSetFeatureDates(updates); }

    // [Offline mode] This function can be expanded to persist scenario updates in localStorage for draft/offline scenarios.
    // Currently disabled for code simplification. See issue #offline-mode.
    //async persistScenarioOverrides(id, overrides) { return this.providers['mock'].persistScenarioOverrides(id, overrides); }
    async listScenarios() { return this.providers['mock'].listScenarios(); }
    async deleteScenario(id) { return this.providers['mock'].deleteScenario(id); }
    async renameScenario(id, name) { return this.providers['mock'].renameScenario(id, name); }
    async publishBaseline(selectedOverrides, scenario) { return this.providers['mock'].publishBaseline(selectedOverrides, scenario); }
    async refreshBaseline() { return this.providers['mock'].refreshBaseline(); }
    async syncScenario(scenario) { return this.providers['mock'].syncScenario(scenario); }
    async saveScenario(scenario) { return this.providers['mock'].saveScenario(scenario); }
}

const providerMock = new ProviderMock();
const providerLocalStorage = new ProviderLocalStorage();
const providerREST = new ProviderREST();
export const dataService = new DataService({'mock' : providerMock, 'rest': providerREST, 'local': providerLocalStorage});
